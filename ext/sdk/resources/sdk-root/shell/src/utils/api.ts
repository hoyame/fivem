import { Deferred } from 'backend/deferred';
import ReconnectingWebScoket from 'reconnectingwebsocket';
import { enableLogger, errorLog, logger, rootLogger } from './logger';
import { fastRandomId } from './random';

const apiRxLog = logger('api:rx');
const apiTxLog = logger('api:tx');
const hostLog = rootLogger('host');

enableLogger('host');

export const ANY_MESSAGE = Symbol('ANY_MESSAGE');
export type ApiMessageListener = (data: any, type: string | typeof ANY_MESSAGE) => void;
export type ApiMessageCallback<Data> =
  | ((error: string) => void)
  | ((error: null, data: Data) => void);

const messageListeners: {
  [eventType: string]: Set<ApiMessageListener>,
} = {};
const callbackDeferreds: Record<string, Deferred<unknown>> = {};
const messageCallbacks: Record<string, ApiMessageCallback<any>> = {};

let pendingMessages: string[] = [];
let connected = false;

const ws = new ReconnectingWebScoket('ws://localhost:35419/api');
ws.addEventListener('open', () => {
  connected = true;

  if (pendingMessages.length > 0) {
    pendingMessages.forEach((message) => ws.send(message));
    pendingMessages = [];
  }
});
ws.addEventListener('close', () => {
  connected = false;
});
ws.addEventListener('message', (event: MessageEvent) => {
  try {
    const [type, data] = JSON.parse(event.data);

    if (type === '@@log') {
      const [msg, ...args] = data;

      return hostLog(msg, ...args);
    }

    if (type === '@@cb') {
      const [id, type, res] = data;

      const callback = messageCallbacks[id];
      if (!callback) {
        apiRxLog('No callback for message', id);
        return;
      }

      delete messageCallbacks[id];

      if (type === 'error') {
        return callback(res, undefined);
      } else {
        return callback(null, res);
      }
    }

    // apiRxLog(type, data);

    const typeListeners = new Set(messageListeners[type]);
    const anyListeners = new Set(messageListeners[ANY_MESSAGE as any]);

    if (typeListeners) {
      typeListeners.forEach((listener) => listener(data, type));
    }

    if (anyListeners) {
      anyListeners.forEach((listener) => listener(data, type));
    }
  } catch (e) {
    errorLog(e);
  }
});

// window.addEventListener('message', (event) => {
//   try {
//     if (event.data.type !== 'sdkApiMessage') {
//       return;
//     }

//     const [type, data] = event.data.data;

//     if (type === '@@log') {
//       const [msg, ...args] = data;

//       return hostLog(msg, ...args);
//     }

//     apiRxLog(type, data);

//     const typeListeners = new Set(messageListeners[type]);
//     const anyListeners = new Set(messageListeners[ANY_MESSAGE as any]);

//     if (typeListeners) {
//       typeListeners.forEach((listener) => listener(data, type));
//     }

//     if (anyListeners) {
//       anyListeners.forEach((listener) => listener(data, type));
//     }
//   } catch (e) {
//     errorLog(e);
//   }
// });

export interface ApiMessage {
  type: string,
  data?: any,
};

export const sendApiMessage = (type: string, data?: any) => {
  // apiTxLog(type, data);

  const message = JSON.stringify([type, data]);

  // fxdkSendApiMessage(message);

  if (connected) {
    ws.send(message);
  } else {
    pendingMessages.push(message);
  }
}

export const sendApiMessageCallback = <ResponseData>(type: string, data: any, callback: ApiMessageCallback<ResponseData>): (() => void) => {
  const id = fastRandomId();

  messageCallbacks[id] = callback;

  const message = JSON.stringify(['@@cb', id, type, data]);
  console.log(message);

  if (connected) {
    ws.send(message);
  } else {
    pendingMessages.push(message);
  }

  return () => delete messageCallbacks[id];
};

export const onApiMessage = (type: string | typeof ANY_MESSAGE, cb: ApiMessageListener) => {
  const listeners = messageListeners[type as any] || (messageListeners[type as any] = new Set());

  listeners.add(cb);

  return () => offApiMessage(type, cb);
};

export const offApiMessage = (type: string | typeof ANY_MESSAGE, cb: ApiMessageListener) => {
  const listeners = messageListeners[type as any];

  if (listeners) {
    listeners.delete(cb);
  }
}
