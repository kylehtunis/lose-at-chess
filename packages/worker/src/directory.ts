// The single LobbyDirectory object. Holds the waiting and in-progress counts
// for every lobby and pushes them to home-page clients. Lobbies report their
// queue length; games report when they start and finish.
import { DurableObject } from 'cloudflare:workers';
import { LOBBY_IDS, type DirectoryServerMessage, type LobbyCounts, type LobbyId } from '@lose-at-chess/protocol';

const COUNTS_KEY = 'counts';

type Counts = Record<LobbyId, LobbyCounts>;

function emptyCounts(): Counts {
  return Object.fromEntries(LOBBY_IDS.map((id) => [id, { waiting: 0, inProgress: 0 }])) as Counts;
}

export function directoryStub(env: Env) {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
}

export class LobbyDirectory extends DurableObject<Env> {
  private counts: Counts = emptyCounts();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.counts = (await ctx.storage.get<Counts>(COUNTS_KEY)) ?? emptyCounts();
    });
  }

  // --- RPC ---

  async setWaiting(lobby: LobbyId, waiting: number) {
    this.counts[lobby].waiting = waiting;
    await this.publish();
  }

  async adjustInProgress(lobby: LobbyId, delta: number) {
    this.counts[lobby].inProgress = Math.max(0, this.counts[lobby].inProgress + delta);
    await this.publish();
  }

  async getCounts(): Promise<Counts> {
    return this.counts;
  }

  // --- WebSocket ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify(this.countsMessage()));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage() {
    // Clients only listen.
  }

  async webSocketClose() {}

  async webSocketError() {}

  private async publish() {
    await this.ctx.storage.put(COUNTS_KEY, this.counts);
    const text = JSON.stringify(this.countsMessage());
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // Closing socket; nothing to do.
      }
    }
  }

  private countsMessage(): DirectoryServerMessage {
    return { type: 'counts', counts: this.counts };
  }
}
