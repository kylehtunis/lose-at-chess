// Live lobby counts for the home page, pushed by the LobbyDirectory object.
import { LOBBY_IDS, type DirectoryServerMessage, type LobbyCounts, type LobbyId } from '@lose-at-chess/protocol';
import { type ConnectionStatus, TypedSocket } from './socket';

export class LobbyDirectoryFeed {
  counts = $state<Record<LobbyId, LobbyCounts>>(
    Object.fromEntries(LOBBY_IDS.map((id) => [id, { waiting: 0, inProgress: 0 }])) as Record<LobbyId, LobbyCounts>,
  );
  connection = $state<ConnectionStatus>('connecting');

  private socket = new TypedSocket<never, DirectoryServerMessage>('/ws/directory', {
    onMessage: (message) => {
      if (message.type === 'counts') this.counts = message.counts;
    },
    onStatus: (status) => (this.connection = status),
  });

  constructor() {
    this.socket.connect();
  }

  close() {
    this.socket.close();
  }
}
