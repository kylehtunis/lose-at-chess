import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { PROTOCOL_VERSION, type ServerMessage, hashEngineReport } from '@lose-at-chess/protocol';

// A connected client with a queue of received messages.
class Client {
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async nextOfType<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const message = await this.next();
      if (message.type === type) return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

async function createGame(gameId: string) {
  const stub = env.GAME.get(env.GAME.idFromName(gameId));
  const response = await stub.fetch('https://game/create', {
    method: 'POST',
    body: JSON.stringify({ setupMoves: 10, timed: false }),
  });
  expect(response.status).toBe(204);
  return stub;
}

async function connect(stub: DurableObjectStub, token: string): Promise<Client> {
  const response = await stub.fetch('https://game/ws', { headers: { Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  const client = new Client(response.webSocket!);
  client.send({ type: 'hello', token, version: PROTOCOL_VERSION });
  return client;
}

describe('Game durable object', () => {
  it('seats two players with opposite colors and starts the setup phase', async () => {
    const stub = await createGame('seatingtest');
    const first = await connect(stub, 'token-a');
    const firstState = await first.nextOfType('state');
    expect(firstState.phase).toBe('waiting');
    expect(firstState.opponentConnected).toBe(false);

    const second = await connect(stub, 'token-b');
    const secondState = await second.nextOfType('state');
    expect(secondState.phase).toBe('setup');
    expect(secondState.color).not.toBe(firstState.color);

    expect(await first.nextOfType('phase')).toEqual({ type: 'phase', phase: 'setup' });
  });

  it('rejects a third player', async () => {
    const stub = await createGame('fulltest');
    await connect(stub, 'token-a');
    await connect(stub, 'token-b');
    const third = await connect(stub, 'token-c');
    expect(await third.nextOfType('error')).toMatchObject({ code: 'game-full' });
  });

  it('validates moves, enforces turn order, and broadcasts accepted moves', async () => {
    const stub = await createGame('movetest');
    const a = await connect(stub, 'token-a');
    const b = await connect(stub, 'token-b');
    const aState = await a.nextOfType('state');
    const white = aState.color === 'w' ? a : b;
    const black = aState.color === 'w' ? b : a;

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
    const a = await connect(stub, 'token-a');
    const b = await connect(stub, 'token-b');
    const aState = await a.nextOfType('state');
    const white = aState.color === 'w' ? a : b;
    const black = aState.color === 'w' ? b : a;
    const plies = [['e2', 'e4'], ['e7', 'e5'], ['d1', 'h5'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6'], ['h5', 'f7']];
    for (const [i, [from, to]] of plies.entries()) {
      const mover = i % 2 === 0 ? white : black;
      mover.send({ type: 'move', from, to });
      await mover.nextOfType('move');
    }
    expect((await white.nextOfType('result')).result).toEqual({ outcome: 'checkmate', winner: 'b', reason: 'checkmate' });
    expect((await black.nextOfType('result')).result.winner).toBe('b');
  });

  it('hands over to the engine phase when setup moves run out', async () => {
    const stub = await createGame('enginetest');
    const a = await connect(stub, 'token-a');
    const b = await connect(stub, 'token-b');
    const aState = await a.nextOfType('state');
    const white = aState.color === 'w' ? a : b;
    const black = aState.color === 'w' ? b : a;
    // Ten distinct moves per side with no repetition or capture.
    const plies = [
      ['a2', 'a3'], ['a7', 'a6'], ['b2', 'b3'], ['b7', 'b6'], ['c2', 'c3'], ['c7', 'c6'],
      ['d2', 'd3'], ['d7', 'd6'], ['e2', 'e3'], ['e7', 'e6'], ['f2', 'f3'], ['f7', 'f6'],
      ['g2', 'g3'], ['g7', 'g6'], ['h2', 'h3'], ['h7', 'h6'], ['b1', 'd2'], ['b8', 'd7'],
      ['g1', 'e2'], ['g8', 'e7'],
    ];
    for (const [i, [from, to]] of plies.entries()) {
      const mover = i % 2 === 0 ? white : black;
      mover.send({ type: 'move', from, to });
      await mover.nextOfType('move');
    }
    expect(await white.nextOfType('phase')).toEqual({ type: 'phase', phase: 'engine' });
  });
});

describe('engine-phase verification', () => {
  const SETUP = [
    ['a2', 'a3'], ['a7', 'a6'], ['b2', 'b3'], ['b7', 'b6'], ['c2', 'c3'], ['c7', 'c6'],
    ['d2', 'd3'], ['d7', 'd6'], ['e2', 'e3'], ['e7', 'e6'], ['f2', 'f3'], ['f7', 'f6'],
    ['g2', 'g3'], ['g7', 'g6'], ['h2', 'h3'], ['h7', 'h6'], ['b1', 'd2'], ['b8', 'd7'],
    ['g1', 'e2'], ['g8', 'e7'],
  ];
  const RESULT = { outcome: 'checkmate', winner: 'w', reason: 'checkmate' } as const;

  async function reachEnginePhase(gameId: string) {
    const stub = await createGame(gameId);
    const a = await connect(stub, 'token-a');
    const b = await connect(stub, 'token-b');
    const aState = await a.nextOfType('state');
    const white = aState.color === 'w' ? a : b;
    const black = aState.color === 'w' ? b : a;
    for (const [i, [from, to]] of SETUP.entries()) {
      const mover = i % 2 === 0 ? white : black;
      mover.send({ type: 'move', from, to });
      await mover.nextOfType('move');
    }
    await white.nextOfType('phase');
    await black.nextOfType('phase');
    return { white, black };
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

  it('rejects a report whose hash does not match its contents', async () => {
    const { white } = await reachEnginePhase('verifybadhash');
    white.send({ type: 'engine-result', moves: ['e1f2'], result: RESULT, hash: 'nope' });
    expect(await white.nextOfType('error')).toMatchObject({ code: 'bad-report' });
  });
});
