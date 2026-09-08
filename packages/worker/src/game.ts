// One Durable Object per game. The authority for seats, the move list, and
// phase transitions. Uses the hibernatable WebSocket API so idle games cost
// nothing; per-socket identity lives in the socket attachment.
import { DurableObject } from 'cloudflare:workers';
import type { Chess } from 'chess.js';
import {
  ENGINE_RECONNECT_GRACE_MS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type Color,
  type EngineReport,
  type ErrorCode,
  type GameResult,
  type GameSettings,
  type GameSnapshot,
  type MoveRecord,
  type Phase,
  type ServerMessage,
  hashEngineReport,
  replayMoves,
  setupPhaseIsOver,
  terminalResult,
  tryMove,
} from '@lose-at-chess/protocol';

interface GameRecord {
  settings: GameSettings;
  seats: Record<Color, string | null>;
  moves: MoveRecord[];
  phase: Phase;
  result: GameResult | null;
  // Engine-phase reports, one per color, until both are in.
  reports: Partial<Record<Color, EngineReport>>;
  // When the engine-phase grace period for a dropped opponent expires, or
  // null if no grace period is running.
  engineGraceDeadline: number | null;
}

// Stored on each accepted socket so identity survives hibernation.
interface Attachment {
  token: string;
  color: Color;
}

const RECORD_KEY = 'record';

function otherColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export class Game extends DurableObject<Env> {
  private record: GameRecord | null = null;
  private chess: Chess | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.record = (await ctx.storage.get<GameRecord>(RECORD_KEY)) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/create') {
      if (this.record) return new Response('Game already exists', { status: 409 });
      const settings = (await request.json()) as GameSettings;
      this.record = {
        settings,
        seats: { w: null, b: null },
        moves: [],
        phase: 'waiting',
        result: null,
        reports: {},
        engineGraceDeadline: null,
      };
      await this.save();
      return new Response(null, { status: 204 });
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      if (!this.record) return new Response('No such game', { status: 404 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendError(ws, 'bad-message', 'Messages must be JSON');
      return;
    }
    switch (message.type) {
      case 'hello':
        await this.handleHello(ws, message.token, message.version);
        return;
      case 'move':
        await this.handleMove(ws, message.from, message.to, message.promotion);
        return;
      case 'engine-result':
        await this.handleEngineResult(ws, message);
        return;
      default:
        this.sendError(ws, 'bad-message', 'Unknown message type');
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.handleDisconnect(ws);
  }

  // --- Handlers ---

  private async handleHello(ws: WebSocket, token: string, version: number) {
    if (version !== PROTOCOL_VERSION) {
      this.sendError(ws, 'version-mismatch', 'Please reload to get the latest version');
      ws.close(1008, 'version-mismatch');
      return;
    }
    const record = this.requireRecord();
    const color = this.seatFor(record, token);
    if (!color) {
      this.sendError(ws, 'game-full', 'This game already has two players');
      ws.close(1008, 'game-full');
      return;
    }
    ws.serializeAttachment({ token, color } satisfies Attachment);

    if (record.phase === 'waiting' && record.seats.w && record.seats.b) {
      record.phase = 'setup';
      this.broadcast({ type: 'phase', phase: 'setup' }, ws);
    }
    await this.save();

    this.send(ws, { type: 'state', ...this.snapshotFor(color) });
    this.broadcastTo(otherColor(color), { type: 'opponent-status', connected: true });
  }

  private async handleMove(ws: WebSocket, from: string, to: string, promotion?: string) {
    const record = this.requireRecord();
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) {
      this.sendError(ws, 'bad-message', 'Send hello first');
      return;
    }
    if (record.phase !== 'setup') {
      this.rejectMove(ws, who.color, 'wrong-phase', 'Moves are only accepted during the setup phase');
      return;
    }
    const chess = this.position();
    if (chess.turn() !== who.color) {
      this.rejectMove(ws, who.color, 'not-your-turn', 'It is not your turn');
      return;
    }
    const move = tryMove(chess, from, to, promotion);
    if (!move) {
      this.rejectMove(ws, who.color, 'illegal-move', 'That move is not legal');
      return;
    }

    record.moves.push(move);
    this.broadcast({ type: 'move', move });

    const result = terminalResult(chess);
    if (result) {
      this.completeGame(record, result);
    } else if (setupPhaseIsOver(record.moves.length, record.settings.setupMoves)) {
      record.phase = 'engine';
      this.broadcast({ type: 'phase', phase: 'engine' });
    }
    await this.save();
  }

  // Stores a client's account of the engine phase, then checks whether the
  // reports on hand settle the result.
  private async handleEngineResult(ws: WebSocket, report: EngineReport) {
    const record = this.requireRecord();
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) {
      this.sendError(ws, 'bad-message', 'Send hello first');
      return;
    }
    if (record.phase !== 'engine') {
      this.sendError(ws, 'wrong-phase', 'The game is not in the engine phase');
      return;
    }
    const expectedHash = await hashEngineReport(report.moves, report.result);
    if (report.hash !== expectedHash) {
      this.sendError(ws, 'bad-report', 'Report hash does not match its contents');
      return;
    }
    record.reports[who.color] = { moves: report.moves, result: report.result, hash: report.hash };
    await this.settleEnginePhase(record);
    await this.save();
  }

  // The alarm is only ever the engine-phase grace period today. The move clock
  // and the in-game reconnect window will have to share it, taking the
  // earliest deadline of the three.
  async alarm() {
    const record = this.requireRecord();
    // Clear the deadline before settling, so a player who returns during the
    // grace period and drops again gets a fresh one.
    record.engineGraceDeadline = null;
    await this.settleEnginePhase(record, true);
    await this.save();
  }

  // Ends the engine phase once the reports settle it. Two matching reports
  // give the result and two differing ones void the game. A single report is
  // enough when the other player has left and has not come back within the
  // grace period: the engine phase needs no input from either of them, so a
  // player who closes the window rather than watch it out still gets the
  // result the remaining client computed.
  //
  // Called whenever a report arrives or a socket closes; `graceExpired` marks
  // the call that comes from the alarm.
  private async settleEnginePhase(record: GameRecord, graceExpired = false) {
    if (record.phase !== 'engine') return;
    const white = record.reports.w;
    const black = record.reports.b;

    if (white && black) {
      if (white.hash === black.hash) {
        this.completeGame(record, white.result);
      } else {
        console.error('Engine-phase mismatch', JSON.stringify({ setup: record.moves, white, black }));
        this.completeGame(record, { outcome: 'void', reason: 'void' });
      }
      return;
    }

    const only = white ?? black;
    if (!only) return;
    if (this.isConnected(white ? 'b' : 'w')) return;

    // Wait out a short grace period first, so a dropped connection that comes
    // straight back still produces a result both clients verified.
    if (!graceExpired) {
      if (record.engineGraceDeadline != null) return;
      record.engineGraceDeadline = Date.now() + ENGINE_RECONNECT_GRACE_MS;
      await this.ctx.storage.setAlarm(record.engineGraceDeadline);
      return;
    }
    this.completeGame(record, only.result);
  }

  private completeGame(record: GameRecord, result: GameResult) {
    record.result = result;
    record.phase = 'complete';
    this.broadcast({ type: 'phase', phase: 'complete' });
    this.broadcast({ type: 'result', result });
  }

  private async handleDisconnect(ws: WebSocket) {
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) return;
    // Another tab for the same player may still be open.
    if (this.isConnected(who.color)) return;
    this.broadcastTo(otherColor(who.color), { type: 'opponent-status', connected: false });

    const record = this.requireRecord();
    if (record.phase !== 'engine') return;
    await this.settleEnginePhase(record);
    await this.save();
  }

  // --- Seating ---

  // Returns the token's existing seat, or assigns a free one. The first
  // player gets a random color; the second gets whatever is left.
  private seatFor(record: GameRecord, token: string): Color | null {
    if (record.seats.w === token) return 'w';
    if (record.seats.b === token) return 'b';
    const free = (['w', 'b'] as Color[]).filter((c) => record.seats[c] === null);
    const color = free[Math.floor(Math.random() * free.length)];
    if (!color) return null;
    record.seats[color] = token;
    return color;
  }

  // --- State helpers ---

  private requireRecord(): GameRecord {
    if (!this.record) throw new Error('Game record missing');
    return this.record;
  }

  // The chess.js instance is rebuilt from the move list after hibernation.
  private position(): Chess {
    if (!this.chess) this.chess = replayMoves(this.requireRecord().moves);
    return this.chess;
  }

  private async save() {
    await this.ctx.storage.put(RECORD_KEY, this.requireRecord());
  }

  private snapshotFor(color: Color): GameSnapshot {
    const record = this.requireRecord();
    return {
      settings: record.settings,
      color,
      phase: record.phase,
      moves: record.moves,
      opponentConnected: this.isConnected(otherColor(color)),
      result: record.result,
    };
  }

  private isConnected(color: Color): boolean {
    return this.socketsFor(color).length > 0;
  }

  private socketsFor(color: Color): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const who = ws.deserializeAttachment() as Attachment | null;
      return who?.color === color;
    });
  }

  // --- Sending ---

  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket is closing; the close handler will tidy up.
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { type: 'error', code, message });
  }

  // A rejected move is followed by a snapshot so the client can resync any
  // optimistic state.
  private rejectMove(ws: WebSocket, color: Color, code: ErrorCode, message: string) {
    this.sendError(ws, code, message);
    this.send(ws, { type: 'state', ...this.snapshotFor(color) });
  }

  private broadcast(message: ServerMessage, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except && ws.deserializeAttachment()) this.send(ws, message);
    }
  }

  private broadcastTo(color: Color, message: ServerMessage) {
    for (const ws of this.socketsFor(color)) this.send(ws, message);
  }
}
