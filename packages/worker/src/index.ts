import { type CreateInviteRequest, type CreateInviteResponse, isLobbyId, parseSettings } from '@lose-at-chess/protocol';
import { GAME_ID_PATTERN, newGameId } from './ids';
import { directoryStub } from './directory';

export { Game } from './game';
export { Lobby } from './lobby';
export { LobbyDirectory } from './directory';

const GAME_SOCKET_ROUTE = /^\/ws\/game\/([a-z0-9]+)$/;
const LOBBY_SOCKET_ROUTE = /^\/ws\/lobby\/([a-z0-9-]+)$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function expectWebSocket(request: Request): Response | null {
  if (request.headers.get('Upgrade') === 'websocket') return null;
  return new Response('Expected a WebSocket', { status: 426 });
}

// Creates a game with the creator already seated. The game id is the invite
// code; the client builds the /invite/:code link from it.
async function createInvite(env: Env, body: unknown): Promise<Response> {
  const { token, settings: rawSettings } = (body ?? {}) as Partial<CreateInviteRequest>;
  const settings = parseSettings(rawSettings);
  if (typeof token !== 'string' || !token || !settings) return json({ error: 'Invalid request' }, 400);

  const gameId = newGameId();
  const stub = env.GAME.get(env.GAME.idFromName(gameId));
  const creatorColor = Math.random() < 0.5 ? 'w' : 'b';
  await stub.create(settings, {
    seats: { w: creatorColor === 'w' ? token : null, b: creatorColor === 'b' ? token : null },
    invite: true,
  });
  return json({ gameId } satisfies CreateInviteResponse);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const gameMatch = url.pathname.match(GAME_SOCKET_ROUTE);
    if (gameMatch) {
      const gameId = gameMatch[1]!;
      if (!GAME_ID_PATTERN.test(gameId)) return new Response('Bad game id', { status: 400 });
      return expectWebSocket(request) ?? env.GAME.get(env.GAME.idFromName(gameId)).fetch(request);
    }

    const lobbyMatch = url.pathname.match(LOBBY_SOCKET_ROUTE);
    if (lobbyMatch) {
      const lobby = lobbyMatch[1]!;
      if (!isLobbyId(lobby)) return new Response('Unknown lobby', { status: 404 });
      return expectWebSocket(request) ?? env.LOBBY.get(env.LOBBY.idFromName(lobby)).fetch(request);
    }

    if (url.pathname === '/ws/directory') {
      return expectWebSocket(request) ?? directoryStub(env).fetch(request);
    }

    if (request.method === 'POST' && url.pathname === '/api/invite') {
      return createInvite(env, await request.json().catch(() => null));
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      return new Response('Not found', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
