import React from 'react';
import { Button } from 'components/controls/Button/Button';
import { Modal } from 'components/Modal/Modal';
import { ProjectContext } from 'contexts/ProjectContext';
import { RecentProjectItem } from 'components/RecentProjectItem/RecentProjectItem';
import { useSendApiMessageCallback } from 'utils/hooks';
import { projectApi } from 'shared/api.events';
import { PathSelector } from 'components/controls/PathSelector/PathSelector';
import s from './ProjectOpener.module.scss';


export const ProjectOpener = React.memo(function ProjectOpener() {
  const { project, recentProjects, closeOpener, openProject: baseOpenProject } = React.useContext(ProjectContext);
  const [projectPath, setProjectPath] = React.useState<string>();

  const [projectPathChecking, setProjectPathChecking] = React.useState(false);
  const [projectPathOpenable, setProjectPathOpenable] = React.useState(true);

  const checkProjectPath = useSendApiMessageCallback<string, boolean>(projectApi.checkOpenRequest, (error, result) => {
    setProjectPathChecking(false);
    setProjectPathOpenable(result && !error);
  });

  const openSelectedProject = React.useCallback(() => {
    if (projectPath && projectPathOpenable) {
      baseOpenProject(projectPath);
      closeOpener();
    }
  }, [closeOpener, projectPath, baseOpenProject, projectPathOpenable]);

  const handleProjectPathChange = React.useCallback((newProjectPath) => {
    setProjectPathChecking(true);
    setProjectPath(newProjectPath);
    checkProjectPath(newProjectPath);
  }, [setProjectPath, checkProjectPath, setProjectPathChecking]);

  const recents = recentProjects
    // No need to show current open porject
    .filter((recentProject) => project?.path !== recentProject.path)
    .map((recentProject) => (
      <RecentProjectItem
        key={recentProject.path}
        recentProject={recentProject}
      />
    ));

  return (
    <Modal fullWidth onClose={closeOpener}>
      <div className={s.root}>
        <div className="modal-header">
          Open project
        </div>

        {!!recents.length && (
          <>
            <div className={s.label}>
              Recent projects
            </div>

            <div className={s.recents}>
              {recents}
            </div>
          </>
        )}

        <div className={s.label}>
          Choose project from filesystem
        </div>
        <div className="modal-block">
          <PathSelector
            value={projectPath}
            onChange={handleProjectPathChange}
            showLoader={projectPathChecking}
            description={!projectPathOpenable && `Path doesn't look like an FxDK project`}
          />
        </div>

        <div className="modal-actions">
          <Button
            theme="primary"
            text="Open selected project"
            disabled={!projectPath || !projectPathOpenable}
            onClick={openSelectedProject}
          />
          <Button
            text="Cancel"
            onClick={closeOpener}
          />
        </div>
      </div>
    </Modal>
  );
});
