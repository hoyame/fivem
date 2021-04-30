import { inject, injectable } from 'inversify';
import { AssetCreateRequest } from 'shared/api.requests';
import { AssetManagerContribution } from '../../asset-manager-contribution';
import { ApiClient } from 'backend/api/api-client';
import { LogService } from 'backend/logger/log-service';
import { FsService } from 'backend/fs/fs-service';
import { FilesystemEntry } from 'shared/api.types';
import { ContainerAccess } from 'backend/container-access';
import { Resource } from './resource';
import { ResourceManifest, ResourceManifestKind } from './resource-manifest';
import { ResourceTemplateScaffolderArgs } from 'resource-templates/types';
import { resourceTemplateScaffolders } from 'resource-templates/scaffolders-list';
import { ProjectAccess } from 'backend/project/project-access';
import { getResourceManifestKind } from './resource-utils';
import { AssetInterface } from '../../asset-types';

@injectable()
export class ResourceManager implements AssetManagerContribution {
  @inject(ApiClient)
  protected readonly apiClient: ApiClient;

  @inject(LogService)
  protected readonly logService: LogService;

  @inject(FsService)
  protected readonly fsService: FsService;

  @inject(ContainerAccess)
  protected readonly containerAccess: ContainerAccess;

  @inject(ProjectAccess)
  protected readonly projectAccess: ProjectAccess;

  async createAsset(request: AssetCreateRequest): Promise<boolean> {
    this.logService.log('Creating resource asset', request);

    const resourcePath = this.fsService.joinPath(request.assetPath, request.assetName);

    await this.fsService.mkdirp(resourcePath);

    // tap manifest file so fxdk knows it is a resource
    await this.fsService.writeFile(this.fsService.joinPath(resourcePath, 'fxmanifest.lua'), '');

    this.projectAccess.withInstance((project) => project.applyManifest((manifest) => {
      manifest.resources[request.assetName] = {
        name: request.assetName,
        enabled: true,
        restartOnChange: false,
      };
    }));

    const resourceManifest = new ResourceManifest();

    const scaffoldingArgs: ResourceTemplateScaffolderArgs = {
      request,
      resourcePath,
      manifest: resourceManifest,
    };

    await this.scaffold(scaffoldingArgs);

    await this.saveResourceManifest(resourcePath, resourceManifest);

    this.logService.log('Finished creating asset', request);

    if (request.callback) {
      request.callback();
    }

    return true;
  }

  loadAsset(assetEntry: FilesystemEntry): AssetInterface | void {
    if (!assetEntry.meta.isResource) {
      return;
    }

    const resource = this.containerAccess.resolve(Resource);

    resource.setEntry(assetEntry);
    resource.init();

    return resource;
  }

  onFsEntry(entry: FilesystemEntry) {
    if (entry.meta.isResource) {
      return this.projectAccess.withInstance((project) => project.applyResourcesChange((resources) => {
        resources[entry.name] = {
          ...project.getResourceConfig(entry.name),
          path: entry.path,
          running: false,
        };
      }));
    }

    const resourceManifestKind = getResourceManifestKind(entry);
    if (resourceManifestKind === ResourceManifestKind.none) {
      return;
    }

    this.projectAccess.withInstance((project) => {
      const entryParentDirPath = this.fsService.dirname(entry.path);

      // It might be so folder entry was process before manifest file created leading us to having no resource asset at all
      if (!project.isAsset(entryParentDirPath, Resource)) {
        project.fsMapping.forceEntryScan(entryParentDirPath);
      }
    });
  }

  private async saveResourceManifest(resourcePath: string, resourceManifest: ResourceManifest) {
    const fxmanifestPath = this.fsService.joinPath(resourcePath, 'fxmanifest.lua');
    const fxmanifestContent = resourceManifest.toString();

    await this.fsService.writeFile(fxmanifestPath, fxmanifestContent);
  }

  private async scaffold(args: ResourceTemplateScaffolderArgs) {
    const scaffolderCtor = resourceTemplateScaffolders[args.request.data?.resourceTemplateId];
    if (!scaffolderCtor) {
      return;
    }

    await this.containerAccess.resolve(scaffolderCtor).scaffold(args);
  }
}
