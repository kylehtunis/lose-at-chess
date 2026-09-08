// A seat in one lobby's queue. Stays queued while the socket is open; the
// server closes it with `matched` once an opponent turns up.
import { PROTOCOL_VERSION, type LobbyClientMessage, type LobbyId, type LobbyServerMessage } from '@lose-at-chess/protocol';
import { type ConnectionStatus, TypedSocket } from './socket';
import { getClientToken } from './token';

export class LobbyQueue {
  connection = $state<ConnectionStatus>('connecting');
  matchedGameId = $state<string | null>(null);
  errorMessage = $state<string | null>(null);

  private socket: TypedSocket<LobbyClientMessage, LobbyServerMessage>;

  constructor(readonly lobby: LobbyId) {
    this.socket = new TypedSocket(`/ws/lobby/${lobby}`, {
      onOpen: () => this.socket.send({ type: 'queue', token: getClientToken(), lobby, version: PROTOCOL_VERSION }),
      onMessage: (message) => this.handleMessage(message),
      onStatus: (status) => (this.connection = status),
    });
    this.socket.connect();
  }

  cancel() {
    this.socket.close();
  }

  private handleMessage(message: LobbyServerMessage) {
    if (message.type === 'matched') {
      // The server closes the socket next; no reconnect wanted.
      this.socket.close();
      this.matchedGameId = message.gameId;
    } else if (message.type === 'error') {
      this.errorMessage = message.message;
    }
  }
}
