import { interfaces } from "inversify";
import { bindApiContribution } from "backend/api/api-contribution";
import { bindAppContribution } from "backend/app/app-contribution";
import { GameServerInstallerUtils } from "./game-server-installer-utils";
import { GameServerManagerService } from "./game-server-manager-service";
import { GameServerService } from "./game-server-service";
import { GameServerRuntime } from "./game-server-runtime";

export const bindGameServer = (container: interfaces.Container) => {
  container.bind(GameServerRuntime).toSelf().inSingletonScope();

  container.bind(GameServerService).toSelf().inSingletonScope();
  bindAppContribution(container, GameServerService);
  bindApiContribution(container, GameServerService);

  container.bind(GameServerManagerService).toSelf().inSingletonScope();
  bindAppContribution(container, GameServerManagerService);
  bindApiContribution(container, GameServerManagerService);

  container.bind(GameServerInstallerUtils).toSelf().inSingletonScope();
};
