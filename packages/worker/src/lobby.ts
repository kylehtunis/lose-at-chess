// One Lobby object per settings combination. The queue is the set of open
// sockets that have sent `queue` and carry the attachment `pair` clears; two
// of them with different tokens are paired into a new Game at once. A dropped
// socket is a player who left the queue, so nothing but the lobby's own id
// needs storing.
import { DurableObject } from 'cloudflare:workers';
import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type LobbyClientMessage,
  type LobbyId,
  type LobbyServerMessage,
  isLobbyId,
  settingsForLobby,
} from '@lose-at-chess/protocol';
import { directoryStub } from './directory';
import { newGameId } from './ids';

interface Attachment {
  token: string;
}

interface Entry {
  token: string;
  ws: WebSocket;
}

const LOBBY_KEY = 'lobby';

export class Lobby extends DurableObject<Env> {
  // Learned from the first upgrade URL, since an object does not know its name.
  private lobby: LobbyId | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.lobby = (await ctx.storage.get<LobbyId>(LOBBY_KEY)) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const lobby = new URL(request.url).pathname.split('/').pop();
    if (!isLobbyId(lobby)) return new Response('Unknown lobby', { status: 404 });
    if (this.lobby !== lobby) {
      this.lobby = lobby;
      await this.ctx.storage.put(LOBBY_KEY, lobby);
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: LobbyClientMessage;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendError(ws, 'bad-message', 'Messages must be JSON');
      return;
    }
    switch (message.type) {
      case 'queue':
        await this.handleQueue(ws, message.token, message.lobby, message.version);
        return;
      case 'cancel':
        ws.close(1000, 'cancelled');
        return;
      default:
        this.sendError(ws, 'bad-message', 'Unknown message type');
    }
  }

  async webSocketClose() {
    await this.reportWaiting();
  }

  async webSocketError() {
    await this.reportWaiting();
  }

  private async handleQueue(ws: WebSocket, token: string, lobby: LobbyId, version: number) {
    if (version !== PROTOCOL_VERSION) {
      this.sendError(ws, 'version-mismatch', 'Please reload to get the latest version');
      ws.close(1008, 'version-mismatch');
      return;
    }
    if (lobby !== this.lobby) {
      this.sendError(ws, 'bad-lobby', 'Wrong lobby for this connection');
      ws.close(1008, 'bad-lobby');
      return;
    }
    // A player is in at most one queue: a second tab replaces the first.
    for (const other of this.waiting()) {
      if (other.token === token) other.ws.close(1000, 'replaced');
    }
    ws.serializeAttachment({ token } satisfies Attachment);

    const opponent = this.waiting().find((entry) => entry.token !== token);
    if (opponent) await this.pair(lobby, { token, ws }, opponent);
    await this.reportWaiting();
  }

  private async pair(lobby: LobbyId, a: Entry, b: Entry) {
    // Take both players out of the queue before the first await. The object
    // goes on delivering socket messages while an outgoing call is in flight,
    // so a player still holding a queue attachment would be paired a second
    // time and seated in a game their opponent never hears about.
    for (const player of [a, b]) player.ws.serializeAttachment(null);

    const gameId = newGameId();
    const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
    try {
      const stub = this.env.GAME.get(this.env.GAME.idFromName(gameId));
      await stub.create(settingsForLobby(lobby), {
        seats: { w: white.token, b: black.token },
        invite: false,
      });
    } catch (error) {
      // They are out of the queue with no game to go to. Drop both sockets:
      // the client reconnects and queues again.
      console.error('Pairing failed', error);
      for (const player of [a, b]) player.ws.close(1011, 'pairing-failed');
      return;
    }
    for (const player of [a, b]) {
      this.send(player.ws, { type: 'matched', gameId });
      player.ws.close(1000, 'matched');
    }
  }

  // Sockets that have queued, with their identity. A socket we have closed
  // ourselves (matched or replaced) stays in the list until the client
  // acknowledges, and gets no close callback, so it is filtered out here.
  private waiting(): Entry[] {
    const entries: Entry[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const who = ws.deserializeAttachment() as Attachment | null;
      if (who) entries.push({ token: who.token, ws });
    }
    return entries;
  }

  // Best effort: a missed report only skews a count on the home page.
  private async reportWaiting() {
    if (!this.lobby) return;
    const tokens = new Set(this.waiting().map((entry) => entry.token));
    try {
      await directoryStub(this.env).setWaiting(this.lobby, tokens.size);
    } catch (error) {
      console.error('Directory report failed', error);
    }
  }

  private send(ws: WebSocket, message: LobbyServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Closing socket.
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { type: 'error', code, message });
  }
}
