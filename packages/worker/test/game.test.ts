import { describe, expect, it } from 'vitest';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import {
  MOVE_CLOCK_MS,
  PROTOCOL_VERSION,
  type Color,
  type DirectoryServerMessage,
  type GameSettings,
  type LobbyServerMessage,
  type ServerMessage,
  hashEngineReport,
} from '@lose-at-chess/protocol';

// A connected client with a queue of received messages. Waiting for one
// message type leaves the others queued, so tests need not know the exact
// order the server interleaves unrelated messages in.
class Client<M extends { type: string } = ServerMessage> {
  private queue: M[] = [];
  private arrived: (() => void) | null = null;
  closed: Promise<CloseEvent>;

  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      this.queue.push(JSON.parse(event.data as string) as M);
      this.arrived?.();
    });
    this.closed = new Promise((resolve) => ws.addEventListener('close', resolve));
  }

  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  close() {
    this.ws.close();
  }

  async next(): Promise<M> {
    await this.until(() => this.queue.length > 0);
    return this.queue.shift()!;
  }

  async nextOfType<T extends M['type']>(type: T): Promise<Extract<M, { type: T }>> {
    await this.until(() => this.queue.some((m) => m.type === type));
    const index = this.queue.findIndex((m) => m.type === type);
    return this.queue.splice(index, 1)[0] as Extract<M, { type: T }>;
  }

  // Messages of this type received so far and not yet consumed. Use it to
  // assert that something did NOT arrive.
  pendingOfType<T extends M['type']>(type: T): Extract<M, { type: T }>[] {
    return this.queue.filter((m) => m.type === type) as Extract<M, { type: T }>[];
  }

  private async until(ready: () => boolean) {
    while (!ready()) {
      await new Promise<void>((resolve) => (this.arrived = resolve));
      this.arrived = null;
    }
  }
}

const UNTIMED: GameSettings = { setupMoves: 10, timed: false };

// Socket close handlers run after the close returns, so an alarm they set may
// not exist yet when the test asks for it.
async function waitForAlarm(stub: DurableObjectStub) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await runDurableObjectAlarm(stub)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('No alarm was scheduled');
}

// Fires every pending deadline in order until the object has none left.
async function drainAlarms(stub: DurableObjectStub) {
  await waitForAlarm(stub);
  while (await runDurableObjectAlarm(stub));
}

function gameStub(gameId: string) {
  return env.GAME.get(env.GAME.idFromName(gameId));
}

async function createGame(gameId: string, settings = UNTIMED, seats: Record<Color, string | null> = { w: null, b: null }) {
  const stub = gameStub(gameId);
  await stub.create(settings, { seats, invite: false });
  return stub;
}

async function openSocket(stub: DurableObjectStub): Promise<WebSocket> {
  const response = await stub.fetch('https://game/ws', { headers: { Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  return response.webSocket!;
}

async function connect(stub: DurableObjectStub, token: string): Promise<Client> {
  const client = new Client(await openSocket(stub));
  client.send({ type: 'hello', token, version: PROTOCOL_VERSION });
  return client;
}

// Seats two players and returns them by color.
async function seatBoth(stub: DurableObjectStub, tokens = ['token-a', 'token-b']) {
  const a = await connect(stub, tokens[0]!);
  const b = await connect(stub, tokens[1]!);
  const aState = await a.nextOfType('state');
  await b.nextOfType('state');
  // The first player hears about the second one arriving.
  await a.nextOfType('phase');
  await a.nextOfType('opponent-status');
  const white = aState.color === 'w' ? a : b;
  const black = aState.color === 'w' ? b : a;
  return { white, black, whiteToken: aState.color === 'w' ? tokens[0]! : tokens[1]!, blackToken: aState.color === 'w' ? tokens[1]! : tokens[0]! };
}

async function playPlies(white: Client, black: Client, plies: string[][]) {
  for (const [i, [from, to]] of plies.entries()) {
    const mover = i % 2 === 0 ? white : black;
    mover.send({ type: 'move', from, to });
    await mover.nextOfType('move');
  }
}

const SCHOLARS_MATE = [['e2', 'e4'], ['e7', 'e5'], ['d1', 'h5'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6'], ['h5', 'f7']];

// Ten distinct moves per side with no repetition or capture.
const TEN_EACH = [
  ['a2', 'a3'], ['a7', 'a6'], ['b2', 'b3'], ['b7', 'b6'], ['c2', 'c3'], ['c7', 'c6'],
  ['d2', 'd3'], ['d7', 'd6'], ['e2', 'e3'], ['e7', 'e6'], ['f2', 'f3'], ['f7', 'f6'],
  ['g2', 'g3'], ['g7', 'g6'], ['h2', 'h3'], ['h7', 'h6'], ['b1', 'd2'], ['b8', 'd7'],
  ['g1', 'e2'], ['g8', 'e7'],
];

async function finishGame(gameId: string) {
  const stub = await createGame(gameId);
  const players = await seatBoth(stub);
  await playPlies(players.white, players.black, SCHOLARS_MATE);
  await players.white.nextOfType('result');
  await players.black.nextOfType('result');
  return { stub, ...players };
}

describe('Game durable object', () => {
  it('seats two players with opposite colors and starts the setup phase', async () => {
    const stub = await createGame('seatingtest');
    const first = await connect(stub, 'token-a');
    const firstState = await first.nextOfType('state');
    expect(firstState.phase).toBe('waiting');
    expect(firstState.opponent).toBe('gone');

    const second = await connect(stub, 'token-b');
    const secondState = await second.nextOfType('state');
    expect(secondState.phase).toBe('setup');
    expect(secondState.color).not.toBe(firstState.color);
    expect(secondState.opponent).toBe('connected');

    expect(await first.nextOfType('phase')).toEqual({ type: 'phase', phase: 'setup' });
  });

  it('rejects a third player', async () => {
    const stub = await createGame('fulltest');
    await seatBoth(stub);
    const third = await connect(stub, 'token-c');
    expect(await third.nextOfType('error')).toMatchObject({ code: 'game-full' });
  });

  it('honours pre-assigned seats', async () => {
    const stub = await createGame('preseated', UNTIMED, { w: 'token-white', b: 'token-black' });
    const black = await connect(stub, 'token-black');
    expect((await black.nextOfType('state')).color).toBe('b');
    const white = await connect(stub, 'token-white');
    expect((await white.nextOfType('state')).color).toBe('w');
    const third = await connect(stub, 'token-c');
    expect(await third.nextOfType('error')).toMatchObject({ code: 'game-full' });
  });

  it('validates moves, enforces turn order, and broadcasts accepted moves', async () => {
    const stub = await createGame('movetest');
    const { white, black } = await seatBoth(stub);

    black.send({ type: 'move', from: 'e7', to: 'e5' });
    expect(await black.nextOfType('error')).toMatchObject({ code: 'not-your-turn' });

    white.send({ type: 'move', from: 'e2', to: 'e5' });
    expect(await white.nextOfType('error')).toMatchObject({ code: 'illegal-move' });

    white.send({ type: 'move', from: 'e2', to: 'e4' });
    expect((await white.nextOfType('move')).move).toMatchObject({ san: 'e4', by: 'w' });
    expect((await black.nextOfType('move')).move).toMatchObject({ san: 'e4', by: 'w' });
  });

  it('scores a checkmate during setup and completes the game', async () => {
    const stub = await createGame('matetest');
    const { white, black } = await seatBoth(stub);
    await playPlies(white, black, SCHOLARS_MATE);
    expect((await white.nextOfType('result')).result).toEqual({ outcome: 'checkmate', winner: 'b', reason: 'checkmate' });
    expect((await black.nextOfType('result')).result.winner).toBe('b');
  });

  it('hands over to the engine phase when setup moves run out', async () => {
    const stub = await createGame('enginetest');
    const { white, black } = await seatBoth(stub);
    await playPlies(white, black, TEN_EACH);
    expect(await white.nextOfType('phase')).toEqual({ type: 'phase', phase: 'engine' });
  });

  it('tells a client when the game does not exist', async () => {
    const client = new Client(await openSocket(gameStub('nosuchgame')));
    expect(await client.nextOfType('error')).toMatchObject({ code: 'no-such-game' });
  });
});

describe('engine-phase verification', () => {
  const RESULT = { outcome: 'checkmate', winner: 'w', reason: 'checkmate' } as const;

  async function reachEnginePhase(gameId: string) {
    const stub = await createGame(gameId);
    const { white, black, blackToken } = await seatBoth(stub);
    await playPlies(white, black, TEN_EACH);
    await white.nextOfType('phase');
    await black.nextOfType('phase');
    return { stub, white, black, blackToken };
  }

  async function report(moves: string[]) {
    return { type: 'engine-result', moves, result: RESULT, hash: await hashEngineReport(moves, RESULT) };
  }

  it('finalizes the result when both reports match', async () => {
    const { white, black } = await reachEnginePhase('verifymatch');
    const moves = ['e1f2', 'e8f7', 'd1e1'];
    white.send(await report(moves));
    black.send(await report(moves));
    expect((await white.nextOfType('result')).result).toEqual(RESULT);
    expect((await black.nextOfType('result')).result).toEqual(RESULT);
  });

  it('voids the game when the reports differ', async () => {
    const { white, black } = await reachEnginePhase('verifymismatch');
    white.send(await report(['e1f2', 'e8f7']));
    black.send(await report(['e1f2', 'e8f7', 'd1e1']));
    expect((await white.nextOfType('result')).result).toEqual({ outcome: 'void', reason: 'void' });
    expect((await black.nextOfType('result')).result.outcome).toBe('void');
  });

  it('accepts a single report once the other player has left and not returned', async () => {
    const { stub, white, black } = await reachEnginePhase('verifyleftafter');
    white.send(await report(['e1f2', 'e8f7']));
    black.close();
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'reconnecting' });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await white.nextOfType('result')).result).toEqual(RESULT);
  });

  it('accepts a report that arrives after the other player has left', async () => {
    const { stub, white, black } = await reachEnginePhase('verifyleftbefore');
    black.close();
    await white.nextOfType('opponent-status');
    white.send(await report(['e1f2', 'e8f7']));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await white.nextOfType('result')).result).toEqual(RESULT);
  });

  it('holds the result when the dropped player returns, and settles if they drop again', async () => {
    const { stub, white, black, blackToken } = await reachEnginePhase('verifyleftreturns');
    white.send(await report(['e1f2', 'e8f7']));
    black.close();
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'reconnecting' });

    const rejoined = await connect(stub, blackToken);
    expect((await rejoined.nextOfType('state')).phase).toBe('engine');
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'connected' });

    rejoined.close();
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'reconnecting' });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await white.nextOfType('result')).result).toEqual(RESULT);
  });

  it('rejects a report whose hash does not match its contents', async () => {
    const { white } = await reachEnginePhase('verifybadhash');
    white.send({ type: 'engine-result', moves: ['e1f2'], result: RESULT, hash: 'nope' });
    expect(await white.nextOfType('error')).toMatchObject({ code: 'bad-report' });
  });
});

describe('move clock', () => {
  const TIMED: GameSettings = { setupMoves: 10, timed: true };

  it('starts a clock for each side to move and plays a random move on expiry', async () => {
    const stub = await createGame('clocktest', TIMED);
    const { white, black } = await seatBoth(stub);
    const opening = await white.nextOfType('clock');
    expect(opening).toEqual({ type: 'clock', color: 'w', ms: MOVE_CLOCK_MS });
    expect(await black.nextOfType('clock')).toEqual(opening);

    // White's clock runs out: the server moves for White.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const forced = await white.nextOfType('move');
    expect(forced.move).toMatchObject({ by: 'w', timeout: true });
    expect((await black.nextOfType('move')).move).toEqual(forced.move);
    expect(await black.nextOfType('clock')).toMatchObject({ color: 'b' });

    // A normal move restarts the clock for the other side.
    expect(await white.nextOfType('clock')).toMatchObject({ color: 'b' });
    black.send({ type: 'move', from: 'e7', to: 'e5' });
    expect((await black.nextOfType('move')).move).toMatchObject({ san: 'e5', timeout: false });
    expect(await white.nextOfType('clock')).toMatchObject({ color: 'w' });
  });

  it('includes the running clock in the snapshot', async () => {
    const stub = await createGame('clocksnapshot', TIMED);
    const { whiteToken } = await seatBoth(stub);
    const again = await connect(stub, whiteToken);
    const state = await again.nextOfType('state');
    expect(state.clock?.color).toBe('w');
    expect(state.clock!.ms).toBeGreaterThan(0);
    expect(state.clock!.ms).toBeLessThanOrEqual(MOVE_CLOCK_MS);
  });

  it('runs no clock in untimed games', async () => {
    const stub = await createGame('noclock');
    const { whiteToken } = await seatBoth(stub);
    const again = await connect(stub, whiteToken);
    expect((await again.nextOfType('state')).clock).toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});

describe('reconnect and forfeit', () => {
  it('holds the seat while the opponent reconnects', async () => {
    const stub = await createGame('reconnecttest');
    const { white, black, blackToken } = await seatBoth(stub);
    white.send({ type: 'move', from: 'e2', to: 'e4' });
    await white.nextOfType('move');
    black.close();
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'reconnecting' });

    const back = await connect(stub, blackToken);
    const state = await back.nextOfType('state');
    expect(state.phase).toBe('setup');
    expect(state.moves.map((m) => m.san)).toEqual(['e4']);
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'connected' });
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it('forfeits a player who stays away past the window', async () => {
    const stub = await createGame('forfeittest');
    const { white, black } = await seatBoth(stub);
    black.close();
    await white.nextOfType('opponent-status');
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'gone' });
    expect((await white.nextOfType('result')).result).toEqual({ outcome: 'forfeit', winner: 'w', reason: 'forfeit' });
  });

  it('forfeits immediately on an explicit leave', async () => {
    const stub = await createGame('leavetest');
    const { white, black } = await seatBoth(stub);
    black.send({ type: 'leave' });
    expect((await white.nextOfType('result')).result).toMatchObject({ outcome: 'forfeit', winner: 'w' });
    await black.closed;
  });

  it('forfeits a matched player who never connects', async () => {
    const stub = await createGame('noshowtest', UNTIMED, { w: 'token-w', b: 'token-b' });
    const white = await connect(stub, 'token-w');
    expect((await white.nextOfType('state')).phase).toBe('waiting');
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await white.nextOfType('result')).result).toMatchObject({ outcome: 'forfeit', winner: 'w' });
  });
});

describe('rematch', () => {
  it('creates a new game with swapped colors when the offer is accepted', async () => {
    const { white, black, whiteToken, blackToken } = await finishGame('rematchaccept');
    white.send({ type: 'rematch-offer' });
    expect(await black.nextOfType('rematch')).toEqual({ type: 'rematch', status: 'offered' });
    black.send({ type: 'rematch-accept' });
    const accepted = await white.nextOfType('rematch');
    expect(accepted).toMatchObject({ status: 'accepted' });
    expect(await black.nextOfType('rematch')).toEqual(accepted);

    const gameId = (accepted as { gameId: string }).gameId;
    const next = gameStub(gameId);
    const formerWhite = await connect(next, whiteToken);
    expect((await formerWhite.nextOfType('state')).color).toBe('b');
    const formerBlack = await connect(next, blackToken);
    const state = await formerBlack.nextOfType('state');
    expect(state.color).toBe('w');
    expect(state.phase).toBe('setup');
  });

  it('tells the offerer when the offer is declined', async () => {
    const { white, black } = await finishGame('rematchdecline');
    white.send({ type: 'rematch-offer' });
    await black.nextOfType('rematch');
    black.send({ type: 'rematch-decline' });
    expect(await white.nextOfType('rematch')).toEqual({ type: 'rematch', status: 'declined' });
  });

  it('withdraws the offer when the opponent leaves', async () => {
    const { white, black } = await finishGame('rematchwithdraw');
    white.send({ type: 'rematch-offer' });
    await black.nextOfType('rematch');
    black.send({ type: 'leave' });
    expect(await white.nextOfType('opponent-status')).toMatchObject({ status: 'gone' });
    expect(await white.nextOfType('rematch')).toEqual({ type: 'rematch', status: 'withdrawn' });
  });

  it('creates one game when accept is sent twice', async () => {
    const { white, black } = await finishGame('rematchdouble');
    white.send({ type: 'rematch-offer' });
    await black.nextOfType('rematch');
    // A double-clicked Accept button: two accepts with no round trip between
    // them, so the second lands while the new game is still being created.
    black.send({ type: 'rematch-accept' });
    black.send({ type: 'rematch-accept' });
    expect(await white.nextOfType('rematch')).toMatchObject({ status: 'accepted' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(white.pendingOfType('rematch')).toEqual([]);
  });

  it('treats a crossed offer as an acceptance', async () => {
    const { white, black } = await finishGame('rematchcrossed');
    white.send({ type: 'rematch-offer' });
    await black.nextOfType('rematch');
    black.send({ type: 'rematch-offer' });
    expect(await white.nextOfType('rematch')).toMatchObject({ status: 'accepted' });
    expect(await black.nextOfType('rematch')).toMatchObject({ status: 'accepted' });
  });

  it('discards a finished game once everyone has been gone for a while', async () => {
    const { stub, white, black } = await finishGame('discardtest');
    white.close();
    black.close();
    // Both reconnect windows close, then the retention period.
    await drainAlarms(stub);
    const later = new Client(await openSocket(stub));
    expect(await later.nextOfType('error')).toMatchObject({ code: 'no-such-game' });
  });
});

describe('invites', () => {
  async function createInvite(token: string, settings: GameSettings = UNTIMED): Promise<string> {
    const response = await exports.default.fetch('https://example.com/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, settings }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { gameId: string }).gameId;
  }

  it('seats the creator, then the first visitor, and rejects the next', async () => {
    const gameId = await createInvite('creator');
    const stub = gameStub(gameId);
    const creator = await connect(stub, 'creator');
    const created = await creator.nextOfType('state');
    expect(created.phase).toBe('waiting');
    expect(created.invite).toBe(true);

    const friend = await connect(stub, 'friend');
    expect((await friend.nextOfType('state')).phase).toBe('setup');
    expect(await creator.nextOfType('phase')).toEqual({ type: 'phase', phase: 'setup' });

    const stranger = await connect(stub, 'stranger');
    expect(await stranger.nextOfType('error')).toMatchObject({ code: 'game-full' });
  });

  it('lets the creator open their own link in another tab', async () => {
    const gameId = await createInvite('creator');
    const stub = gameStub(gameId);
    await (await connect(stub, 'creator')).nextOfType('state');
    const secondTab = await connect(stub, 'creator');
    expect((await secondTab.nextOfType('state')).phase).toBe('waiting');
  });

  it('expires when the creator leaves before anyone joins', async () => {
    const gameId = await createInvite('creator');
    const stub = gameStub(gameId);
    const creator = await connect(stub, 'creator');
    await creator.nextOfType('state');
    creator.send({ type: 'leave' });
    await creator.closed;
    const friend = new Client(await openSocket(stub));
    expect(await friend.nextOfType('error')).toMatchObject({ code: 'no-such-game' });
  });

  it('expires when the creator drops and does not come back', async () => {
    const gameId = await createInvite('creator');
    const stub = gameStub(gameId);
    const creator = await connect(stub, 'creator');
    await creator.nextOfType('state');
    creator.close();
    await waitForAlarm(stub);
    const friend = new Client(await openSocket(stub));
    expect(await friend.nextOfType('error')).toMatchObject({ code: 'no-such-game' });
  });

  it('rejects bad requests', async () => {
    const response = await exports.default.fetch('https://example.com/api/invite', {
      method: 'POST',
      body: JSON.stringify({ token: 't', settings: { setupMoves: 7, timed: false } }),
    });
    expect(response.status).toBe(400);
  });
});

describe('lobbies and directory', () => {
  async function openLobby(lobby: string): Promise<Client<LobbyServerMessage>> {
    const stub = env.LOBBY.get(env.LOBBY.idFromName(lobby));
    const response = await stub.fetch(`https://lobby/ws/lobby/${lobby}`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(101);
    return new Client<LobbyServerMessage>(response.webSocket!);
  }

  async function openDirectory(): Promise<Client<DirectoryServerMessage>> {
    const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
    const response = await stub.fetch('https://directory/ws/directory', { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(101);
    return new Client<DirectoryServerMessage>(response.webSocket!);
  }

  function queue(client: Client<LobbyServerMessage>, token: string, lobby: string) {
    client.send({ type: 'queue', token, lobby, version: PROTOCOL_VERSION });
  }

  it('pairs two queued players into a game with the lobby settings', async () => {
    const a = await openLobby('25-timed');
    const b = await openLobby('25-timed');
    queue(a, 'lobby-a', '25-timed');
    queue(b, 'lobby-b', '25-timed');
    const matched = await a.nextOfType('matched');
    expect(await b.nextOfType('matched')).toEqual(matched);
    await a.closed;

    const stub = gameStub(matched.gameId);
    const { white } = await seatBoth(stub, ['lobby-a', 'lobby-b']);
    const again = await connect(stub, 'lobby-a');
    const state = await again.nextOfType('state');
    expect(state.settings).toEqual({ setupMoves: 25, timed: true });
    expect(state.phase).toBe('setup');
    expect(state.invite).toBe(false);
    void white;
  });

  it('does not pair a player with themselves and replaces an earlier queue entry', async () => {
    const first = await openLobby('10-untimed');
    const second = await openLobby('10-untimed');
    queue(first, 'same-token', '10-untimed');
    queue(second, 'same-token', '10-untimed');
    const closed = await first.closed;
    expect(closed.reason).toBe('replaced');

    const other = await openLobby('10-untimed');
    queue(other, 'other-token', '10-untimed');
    expect(await second.nextOfType('matched')).toMatchObject({ gameId: expect.any(String) });
  });

  it('pairs a burst of simultaneous queuers without seating anyone twice', async () => {
    const tokens = ['burst-a', 'burst-b', 'burst-c', 'burst-d'];
    const clients = [];
    for (const _ of tokens) clients.push(await openLobby('25-untimed'));
    // No await in between, so every queue message is in flight at once and
    // each one is handled while the others are creating their games.
    clients.forEach((client, i) => queue(client, tokens[i]!, '25-untimed'));

    const matched = await Promise.all(clients.map((client) => client.nextOfType('matched')));
    const byGame = new Map<string, string[]>();
    matched.forEach((m, i) => byGame.set(m.gameId, [...(byGame.get(m.gameId) ?? []), tokens[i]!]));
    expect(byGame.size).toBe(2);
    expect([...byGame.values()].every((players) => players.length === 2)).toBe(true);

    // Each game seats exactly the two players it told about it, so both are
    // taken on and the setup phase starts.
    for (const [gameId, players] of byGame) {
      const stub = gameStub(gameId);
      const first = await connect(stub, players[0]!);
      const second = await connect(stub, players[1]!);
      const firstState = await first.nextOfType('state');
      const secondState = await second.nextOfType('state');
      expect(secondState.phase).toBe('setup');
      expect(firstState.color).not.toBe(secondState.color);
    }
  });

  it('reports waiting and in-progress counts to the directory', async () => {
    const directory = await openDirectory();
    // The directory object outlives individual tests, so count relative to
    // whatever earlier tests left behind.
    const initial = (await directory.nextOfType('counts')).counts['10-timed'];
    const untilCounts = async (expected: { waiting: number; inProgress: number }) => {
      for (;;) {
        const counts = (await directory.nextOfType('counts')).counts['10-timed'];
        if (counts.waiting === expected.waiting && counts.inProgress === expected.inProgress) return;
      }
    };

    const a = await openLobby('10-timed');
    queue(a, 'count-a', '10-timed');
    await untilCounts({ waiting: 1, inProgress: initial.inProgress });

    const b = await openLobby('10-timed');
    queue(b, 'count-b', '10-timed');
    const matched = await a.nextOfType('matched');
    // The queue empties on pairing; the game counts once both players arrive.
    await untilCounts({ waiting: 0, inProgress: initial.inProgress });

    const stub = gameStub(matched.gameId);
    const { white, black } = await seatBoth(stub, ['count-a', 'count-b']);
    await untilCounts({ waiting: 0, inProgress: initial.inProgress + 1 });

    await playPlies(white, black, SCHOLARS_MATE);
    await white.nextOfType('result');
    await untilCounts({ waiting: 0, inProgress: initial.inProgress });
  });
});
