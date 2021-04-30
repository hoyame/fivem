import React from 'react';
import { ServerStates, ServerUpdateChannel, ServerUpdateChannelsState } from 'shared/api.types';
import { projectApi, serverApi } from 'shared/api.events';
import { sendApiMessage } from 'utils/api';
import { useApiMessage } from 'utils/hooks';
import { logger } from 'utils/logger';
import { sendCommand } from 'utils/sendCommand';
import { ProjectContext } from './ProjectContext';
import { GameContext } from './GameContext';
import { ProjectStartServerRequest } from 'shared/api.requests';
import { getProjectTebexSecretVar } from 'utils/projectStorage';

const log = logger('ServerContext');

export type ResourcesState = Record<string, boolean>;

export interface ServerContext {
  serverState: ServerStates | null,

  updateChannelsState: ServerUpdateChannelsState,

  clientConnected: boolean,
  setClientConnected: (connected: boolean) => void,

  resourcesState: ResourcesState,

  startServer: () => void,
  stopServer: () => void,

  sendServerCommand: (cmd: string) => void,

  checkForUpdates: (updateChannel: ServerUpdateChannel) => void,
  installUpdate: (updateChannel: ServerUpdateChannel) => void,
}
export const ServerContext = React.createContext<ServerContext>({
  serverState: ServerStates.down,

  updateChannelsState: {},

  clientConnected: false,
  setClientConnected: () => {},

  resourcesState: {},

  startServer: () => {},
  stopServer: () => {},

  sendServerCommand: () => {},

  checkForUpdates: () => {},
  installUpdate: () => {},
});

export const ServerContextProvider = React.memo(function ServerContextProvider({ children }) {
  const { project } = React.useContext(ProjectContext);
  const { gameLaunched } = React.useContext(GameContext);

  const [serverState, setServerState] = React.useState<ServerStates | null>(null);
  const [resourcesState, setResourcesState] = React.useState({});
  const [updateChannelsState, setUpdateChannelsState] = React.useState<ServerUpdateChannelsState>({});

  const [clientConnected, setClientConnected] = React.useState(false);

  const startServer = React.useCallback(() => {
    if (project) {
      const steamWebApiKey = ''; //getProjectSteamWebApiKeyVar(project);
      const tebexSecret = getProjectTebexSecretVar(project);

      sendApiMessage(projectApi.startServer, {
        steamWebApiKey,
        tebexSecret,
      } as ProjectStartServerRequest);
    }
  }, [project]);

  const stopServer = React.useCallback(() => {
    sendApiMessage(projectApi.stopServer);
  }, []);

  const sendServerCommand = React.useCallback((cmd: string) => {
    sendApiMessage(serverApi.sendCommand, cmd);
  }, []);

  const checkForUpdates = React.useCallback((updateChannel: ServerUpdateChannel) => {
    sendApiMessage(serverApi.checkForUpdates, updateChannel);
  }, []);

  const installUpdate = React.useCallback((updateChannel: ServerUpdateChannel) => {
    sendApiMessage(serverApi.installUpdate, updateChannel);
  }, []);

  // Handling boot
  React.useEffect(() => {
    sendApiMessage(serverApi.ackState);
    sendApiMessage(serverApi.ackUpdateChannelsState);

    // Ack sdk-game state
    sendCommand('sdk:ackConnected');
  }, []);

  // Handling server state
  React.useEffect(() => {
    switch (serverState) {
      case ServerStates.up: {
        return sendApiMessage(serverApi.ackResourcesState);
      }
      case ServerStates.down: {
        return setResourcesState({});
      }
    }
  }, [serverState, gameLaunched, clientConnected, setResourcesState, setClientConnected]);

  useApiMessage(serverApi.state, (state: ServerStates) => {
    setServerState(state);
  }, [setServerState]);

  useApiMessage(serverApi.updateChannelsState, (newUpdateChannelsState) => {
    setUpdateChannelsState(newUpdateChannelsState);
  });

  useApiMessage(serverApi.resourcesState, (newResourcesState) => {
    log('Resources state', newResourcesState);
    setResourcesState(newResourcesState);
  }, [setResourcesState]);

  const value = {
    serverState,

    updateChannelsState,

    clientConnected,
    setClientConnected,

    resourcesState,

    startServer,
    stopServer,

    sendServerCommand,

    checkForUpdates,
    installUpdate,
  };

  return (
    <ServerContext.Provider value={value}>
      {children}
    </ServerContext.Provider>
  );
});
