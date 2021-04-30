import React from 'react';
import classnames from 'classnames';
import { BsExclamationDiamondFill, BsExclamationTriangleFill, BsPlay, BsStop } from 'react-icons/bs';
import { ProjectContext } from 'contexts/ProjectContext';
import { ServerContext } from 'contexts/ServerContext';
import { ServerStates, ServerUpdateStates } from 'shared/api.types';
import { Indicator } from 'components/Indicator/Indicator';
import s from './ServerButton.module.scss';


export const ServerButton = React.memo(function Server() {
  const { serverState, updateChannelsState, startServer, stopServer, installUpdate } = React.useContext(ServerContext);
  const { project } = React.useContext(ProjectContext);

  const updateChannelState = project
    ? updateChannelsState[project.manifest.serverUpdateChannel]
    : null;

  const rootClassName = classnames(s.root, {
    [s.up]: serverState === ServerStates.up,
    [s.down]: serverState === ServerStates.down,
    [s.booting]: serverState === ServerStates.booting,
    [s.error]: updateChannelState === ServerUpdateStates.missingArtifact,
  });

  let icon;
  let title;

  if (updateChannelState === ServerUpdateStates.ready) {
    switch (serverState) {
      case ServerStates.up: {
        icon = <BsStop />;
        title = 'Stop server';
        break;
      }

      case ServerStates.down: {
        icon = <BsPlay />;
        title = 'Start server';
        break;
      }

      case ServerStates.booting: {
        icon = <Indicator />;
        title = 'Stop server';
        break;
      }
    }
  } else {
    switch (updateChannelState) {
      case ServerUpdateStates.missingArtifact: {
        icon = <BsExclamationDiamondFill />;
        title = 'Missing server artifact';
        break;
      }

      case ServerUpdateStates.updateRequired: {
        icon = <BsExclamationTriangleFill />;
        title = 'Install update';
        break;
      }

      case ServerUpdateStates.checking: {
        icon = <Indicator />;
        title = 'Checking updates';
        break;
      }

      case ServerUpdateStates.updating: {
        icon = <Indicator />;
        title = 'Updating';
      }
    }
  }

  const handleClick = React.useCallback(() => {
    if (project && updateChannelState === ServerUpdateStates.updateRequired) {
      return installUpdate(project.manifest.serverUpdateChannel);
    }

    if (updateChannelState !== ServerUpdateStates.ready) {
      return;
    }

    if (serverState === ServerStates.down) {
      startServer();
    }
    if (serverState === ServerStates.up) {
      stopServer();
    }
  }, [serverState, updateChannelState, startServer, stopServer]);

  return (
    <div className={rootClassName}>
      <div
        className={s.button}
        onClick={handleClick}
        title={title}
      >
        {icon}
      </div>
    </div>
  );
});
