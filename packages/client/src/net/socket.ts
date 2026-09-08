import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@lose-at-chess/protocol';
import { getClientToken } from './token';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface SocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
}

// A typed WebSocket to one Game. Sends `hello` as soon as the socket opens.
export class GameSocket {
  private ws: WebSocket | null = null;

  constructor(
    private readonly path: string,
    private readonly handlers: SocketHandlers,
  ) {}

  connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${scheme}://${location.host}${this.path}`);
    this.handlers.onStatus('connecting');
    this.ws.addEventListener('open', () => {
      this.send({ type: 'hello', token: getClientToken(), version: PROTOCOL_VERSION });
      this.handlers.onStatus('open');
    });
    this.ws.addEventListener('message', (event) => {
      this.handlers.onMessage(JSON.parse(event.data as string) as ServerMessage);
    });
    this.ws.addEventListener('close', () => this.handlers.onStatus('closed'));
  }

  send(message: ClientMessage) {
    this.ws?.send(JSON.stringify(message));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
