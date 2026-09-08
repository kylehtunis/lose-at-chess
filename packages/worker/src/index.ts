import { SETUP_MOVE_OPTIONS, type GameSettings } from '@lose-at-chess/protocol';
import { GAME_ID_PATTERN, newGameId } from './ids';

export { Game } from './game';

const GAME_SOCKET_ROUTE = /^\/ws\/game\/([a-z0-9]+)$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseSettings(input: unknown): GameSettings | null {
  if (typeof input !== 'object' || input === null) return null;
  const { setupMoves, timed } = input as Record<string, unknown>;
  if (!SETUP_MOVE_OPTIONS.includes(setupMoves as GameSettings['setupMoves'])) return null;
  if (typeof timed !== 'boolean') return null;
  return { setupMoves: setupMoves as GameSettings['setupMoves'], timed };
}

async function createGame(env: Env, settings: GameSettings): Promise<string> {
  const gameId = newGameId();
  const stub = env.GAME.get(env.GAME.idFromName(gameId));
  const response = await stub.fetch('https://game/create', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(`Game creation failed: ${response.status}`);
  return gameId;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const socketMatch = url.pathname.match(GAME_SOCKET_ROUTE);
    if (socketMatch) {
      const gameId = socketMatch[1]!;
      if (!GAME_ID_PATTERN.test(gameId)) return new Response('Bad game id', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket', { status: 426 });
      }
      const stub = env.GAME.get(env.GAME.idFromName(gameId));
      return stub.fetch(request);
    }

    // Temporary until lobbies and invites exist: creates a game directly.
    if (request.method === 'POST' && url.pathname === '/api/debug/new-game') {
      const settings = parseSettings(await request.json().catch(() => null));
      if (!settings) return json({ error: 'Invalid settings' }, 400);
      const gameId = await createGame(env, settings);
      return json({ gameId });
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      return new Response('Not found', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
