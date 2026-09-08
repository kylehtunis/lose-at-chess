// One Durable Object per game. The authority for seats, the move list, the
// move clock, reconnect windows, phase transitions, and rematches. Uses the
// hibernatable WebSocket API so idle games cost nothing; per-socket identity
// lives in the socket attachment.
import { DurableObject } from 'cloudflare:workers';
import type { Chess } from 'chess.js';
import {
  ENGINE_RECONNECT_GRACE_MS,
  FINISHED_GAME_RETENTION_MS,
  INVITE_EXPIRY_MS,
  MOVE_CLOCK_MS,
  PROTOCOL_VERSION,
  RECONNECT_WINDOW_MS,
  type ClientMessage,
  type Color,
  type EngineReport,
  type ErrorCode,
  type GameResult,
  type GameSettings,
  type GameSnapshot,
  type MoveRecord,
  type OpponentStatus,
  type Phase,
  type RematchState,
  type ServerMessage,
  hashEngineReport,
  lobbyIdFor,
  randomLegalMove,
  replayMoves,
  setupPhaseIsOver,
  terminalResult,
  tryMove,
} from '@lose-at-chess/protocol';
import { newGameId } from './ids';
import { directoryStub } from './directory';

export interface CreateOptions {
  // Pre-assigned seats: both for lobby matches and rematches, one for an
  // invite. Anyone else who connects takes a free seat.
  seats: Record<Color, string | null>;
  invite: boolean;
}

// Every timer the object runs. The DO has a single alarm, so it is always
// set to the earliest of these.
interface Deadlines {
  // Move clock for the side to move (timed games, setup phase only).
  clock: number | null;
  // How long each absent player's seat is held.
  reconnect: Record<Color, number | null>;
  // Engine phase: a lone report is accepted once this passes.
  engineGrace: number | null;
  // Unclaimed invite is discarded.
  inviteExpiry: number | null;
  // Nobody is connected and the game is finished or abandoned.
  discard: number | null;
}

interface GameRecord {
  settings: GameSettings;
  invite: boolean;
  seats: Record<Color, string | null>;
  moves: MoveRecord[];
  phase: Phase;
  result: GameResult | null;
  // Engine-phase reports, one per color, until both are in.
  reports: Partial<Record<Color, EngineReport>>;
  rematch: RematchState;
  // Players who left for good: forfeited, or departed after the game.
  gone: Record<Color, boolean>;
  // Whether the directory currently counts this game as in progress.
  countedInProgress: boolean;
  deadlines: Deadlines;
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

function earliest(deadlines: Deadlines): number | null {
  const all = [
    deadlines.clock,
    deadlines.reconnect.w,
    deadlines.reconnect.b,
    deadlines.engineGrace,
    deadlines.inviteExpiry,
    deadlines.discard,
  ].filter((d): d is number => d !== null);
  return all.length ? Math.min(...all) : null;
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

  // --- RPC, called by the Worker and other objects ---

  async create(settings: GameSettings, options: CreateOptions): Promise<void> {
    if (this.record) throw new Error('Game already exists');
    const now = Date.now();
    this.record = {
      settings,
      invite: options.invite,
      seats: { ...options.seats },
      moves: [],
      phase: 'waiting',
      result: null,
      reports: {},
      rematch: { offeredBy: null, gameId: null },
      gone: { w: false, b: false },
      countedInProgress: false,
      deadlines: {
        clock: null,
        // Pre-seated players who never turn up are treated like a drop.
        reconnect: {
          w: options.seats.w ? now + RECONNECT_WINDOW_MS : null,
          b: options.seats.b ? now + RECONNECT_WINDOW_MS : null,
        },
        engineGrace: null,
        inviteExpiry: options.invite ? now + INVITE_EXPIRY_MS : null,
        discard: null,
      },
    };
    await this.save();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    if (!this.record) {
      // Accept so the client hears why, rather than seeing a bare failure.
      pair[1].accept();
      pair[1].send(JSON.stringify({ type: 'error', code: 'no-such-game', message: 'This game no longer exists' }));
      pair[1].close(1008, 'no-such-game');
    } else {
      this.ctx.acceptWebSocket(pair[1]);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendError(ws, 'bad-message', 'Messages must be JSON');
      return;
    }
    if (message.type === 'hello') {
      await this.handleHello(ws, message.token, message.version);
      return;
    }
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) {
      this.sendError(ws, 'bad-message', 'Send hello first');
      return;
    }
    switch (message.type) {
      case 'move':
        await this.handleMove(ws, who, message.from, message.to, message.promotion);
        return;
      case 'engine-result':
        await this.handleEngineResult(ws, who, message);
        return;
      case 'rematch-offer':
        await this.handleRematchOffer(who.color);
        return;
      case 'rematch-accept':
        await this.handleRematchAccept(who.color);
        return;
      case 'rematch-decline':
        await this.handleRematchDecline(who.color);
        return;
      case 'leave':
        await this.handleLeave(ws, who.color);
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
    const record = this.record;
    if (!record) {
      this.sendError(ws, 'no-such-game', 'This game no longer exists');
      ws.close(1008, 'no-such-game');
      return;
    }
    const color = this.seatFor(record, token);
    if (!color) {
      this.sendError(ws, 'game-full', 'This game already has two players');
      ws.close(1008, 'game-full');
      return;
    }
    ws.serializeAttachment({ token, color } satisfies Attachment);

    record.deadlines.reconnect[color] = null;
    record.deadlines.discard = null;
    record.gone[color] = false;
    this.broadcastTo(otherColor(color), { type: 'opponent-status', status: 'connected' });

    if (record.phase === 'waiting' && this.isConnected('w') && this.isConnected('b')) {
      // The snapshot below tells the newcomer; only the other player needs the transition.
      await this.startSetupPhase(record, ws);
    }
    this.send(ws, { type: 'state', ...this.snapshotFor(color) });
    await this.save();
  }

  private async handleMove(ws: WebSocket, who: Attachment, from: string, to: string, promotion?: string) {
    const record = this.requireRecord();
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
    await this.acceptMove(record, move);
    await this.save();
  }

  private async acceptMove(record: GameRecord, move: MoveRecord) {
    record.moves.push(move);
    this.broadcast({ type: 'move', move });

    const result = terminalResult(this.position());
    if (result) {
      await this.completeGame(record, result);
    } else if (setupPhaseIsOver(record.moves.length, record.settings.setupMoves)) {
      record.phase = 'engine';
      record.deadlines.clock = null;
      this.broadcast({ type: 'phase', phase: 'engine' });
    } else {
      this.startClock(record);
    }
  }

  // Stores a client's account of the engine phase, then checks whether the
  // reports on hand settle the result.
  private async handleEngineResult(ws: WebSocket, who: Attachment, report: EngineReport) {
    const record = this.requireRecord();
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

  private async handleRematchOffer(color: Color) {
    const record = this.requireRecord();
    if (record.phase !== 'complete' || record.rematch.gameId) return;
    const other = otherColor(color);
    if (record.rematch.offeredBy === other) {
      await this.acceptRematch(record);
    } else if (record.gone[other]) {
      this.broadcastTo(color, { type: 'rematch', status: 'withdrawn' });
    } else if (record.rematch.offeredBy === null) {
      record.rematch.offeredBy = color;
      this.broadcastTo(other, { type: 'rematch', status: 'offered' });
    }
    await this.save();
  }

  private async handleRematchAccept(color: Color) {
    const record = this.requireRecord();
    if (record.phase !== 'complete' || record.rematch.offeredBy !== otherColor(color)) return;
    await this.acceptRematch(record);
    await this.save();
  }

  private async handleRematchDecline(color: Color) {
    const record = this.requireRecord();
    if (record.rematch.offeredBy !== otherColor(color)) return;
    record.rematch.offeredBy = null;
    this.broadcastTo(otherColor(color), { type: 'rematch', status: 'declined' });
    await this.save();
  }

  // The new game keeps the settings and swaps the colors.
  private async acceptRematch(record: GameRecord) {
    if (record.rematch.gameId) return;
    const gameId = newGameId();
    // Claim the rematch before the first await. The object goes on delivering
    // socket messages while the new game is being created, so a second accept
    // (a double-clicked button, or an offer crossing an accept) would
    // otherwise create a second game and split the players between them.
    record.rematch = { offeredBy: null, gameId };
    try {
      const stub = this.env.GAME.get(this.env.GAME.idFromName(gameId));
      await stub.create(record.settings, {
        seats: { w: record.seats.b, b: record.seats.w },
        invite: record.invite,
      });
    } catch (error) {
      // Release the claim so the players can offer again.
      console.error('Rematch creation failed', error);
      record.rematch = { offeredBy: null, gameId: null };
      return;
    }
    this.broadcast({ type: 'rematch', status: 'accepted', gameId });
  }

  private async handleLeave(ws: WebSocket, color: Color) {
    const record = this.requireRecord();
    record.deadlines.reconnect[color] = null;
    await this.playerGone(record, color);
    if (!this.record) return;
    // Closing from our side gives no close callback, so tidy up here.
    ws.close(1000, 'left');
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(ws: WebSocket) {
    const who = ws.deserializeAttachment() as Attachment | null;
    const record = this.record;
    if (!who || !record) return;
    // Another tab for the same player may still be open.
    if (this.isConnected(who.color)) return;

    if (!record.gone[who.color]) {
      record.deadlines.reconnect[who.color] = Date.now() + RECONNECT_WINDOW_MS;
      this.broadcastTo(otherColor(who.color), { type: 'opponent-status', status: 'reconnecting' });
    }
    if (record.phase === 'engine') await this.settleEnginePhase(record);
    this.updateDiscardDeadline(record);
    await this.save();
  }

  // --- Timers ---

  // Every deadline is due at or after the alarm time, so the earliest one is
  // always due when this runs, even if the clock reads slightly early.
  async alarm() {
    const record = this.record;
    if (!record) return;
    const d = record.deadlines;
    const now = Math.max(Date.now(), earliest(d) ?? 0);
    const due = (deadline: number | null) => deadline !== null && deadline <= now;

    if (due(d.clock)) {
      d.clock = null;
      await this.expireClock(record);
    }
    for (const color of ['w', 'b'] as const) {
      if (due(d.reconnect[color])) {
        d.reconnect[color] = null;
        await this.playerGone(record, color);
        if (!this.record) return;
      }
    }
    if (due(d.engineGrace)) {
      d.engineGrace = null;
      await this.settleEnginePhase(record, true);
    }
    if (due(d.inviteExpiry)) {
      d.inviteExpiry = null;
      await this.expireInvite(record);
      return;
    }
    if (due(d.discard)) {
      await this.discard(record);
      return;
    }
    await this.save();
  }

  private startClock(record: GameRecord) {
    if (!record.settings.timed || record.phase !== 'setup') return;
    record.deadlines.clock = Date.now() + MOVE_CLOCK_MS;
    this.broadcast({ type: 'clock', color: this.position().turn(), ms: MOVE_CLOCK_MS });
  }

  // The clock ran out: the server moves for the player.
  private async expireClock(record: GameRecord) {
    if (record.phase !== 'setup') return;
    const move = randomLegalMove(this.position());
    if (move) await this.acceptMove(record, move);
  }

  // A player's reconnect window closed, or they left explicitly.
  private async playerGone(record: GameRecord, color: Color) {
    const other = otherColor(color);
    record.gone[color] = true;
    this.broadcastTo(other, { type: 'opponent-status', status: 'gone' });

    switch (record.phase) {
      case 'waiting':
        if (record.invite && record.seats[other] === null) {
          await this.expireInvite(record);
          return;
        }
        await this.completeGame(record, { outcome: 'forfeit', winner: other, reason: 'forfeit' });
        break;
      case 'setup':
        await this.completeGame(record, { outcome: 'forfeit', winner: other, reason: 'forfeit' });
        break;
      case 'engine':
        // Leaving during the engine phase is not a forfeit; the grace period
        // in settleEnginePhase decides when the remaining report stands.
        break;
      case 'complete':
        if (record.rematch.offeredBy !== null && record.rematch.gameId === null) {
          record.rematch.offeredBy = null;
          this.broadcastTo(other, { type: 'rematch', status: 'withdrawn' });
        }
        break;
    }
    this.updateDiscardDeadline(record);
  }

  // A finished or abandoned game with nobody connected is dropped after a
  // short retention period. Abandoned means both players have been gone
  // long enough to forfeit; in the engine phase that leaves the game
  // unsettled, and nobody is coming back to settle it.
  private updateDiscardDeadline(record: GameRecord) {
    if (this.openSockets().length > 0) {
      record.deadlines.discard = null;
      return;
    }
    const retention =
      record.phase === 'complete' ? FINISHED_GAME_RETENTION_MS : record.phase === 'engine' ? RECONNECT_WINDOW_MS : null;
    if (retention === null) {
      record.deadlines.discard = null;
    } else if (record.deadlines.discard === null) {
      record.deadlines.discard = Date.now() + retention;
    }
  }

  private async expireInvite(record: GameRecord) {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendError(ws, 'no-such-game', 'This invite has expired');
      ws.close(1008, 'no-such-game');
    }
    await this.discard(record);
  }

  private async discard(record: GameRecord) {
    if (record.countedInProgress) await this.reportInProgress(record, -1);
    this.record = null;
    this.chess = null;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }

  // --- Phase transitions ---

  private async startSetupPhase(record: GameRecord, except: WebSocket) {
    record.phase = 'setup';
    record.deadlines.inviteExpiry = null;
    this.broadcast({ type: 'phase', phase: 'setup' }, except);
    this.startClock(record);
    await this.reportInProgress(record, +1);
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
        await this.completeGame(record, white.result);
      } else {
        console.error('Engine-phase mismatch', JSON.stringify({ setup: record.moves, white, black }));
        await this.completeGame(record, { outcome: 'void', reason: 'void' });
      }
      return;
    }

    const only = white ?? black;
    if (!only) return;
    if (this.isConnected(white ? 'b' : 'w')) {
      record.deadlines.engineGrace = null;
      return;
    }

    // Wait out a short grace period first, so a dropped connection that comes
    // straight back still produces a result both clients verified.
    if (!graceExpired) {
      if (record.deadlines.engineGrace === null) {
        record.deadlines.engineGrace = Date.now() + ENGINE_RECONNECT_GRACE_MS;
      }
      return;
    }
    await this.completeGame(record, only.result);
  }

  private async completeGame(record: GameRecord, result: GameResult) {
    record.result = result;
    record.phase = 'complete';
    record.deadlines.clock = null;
    record.deadlines.engineGrace = null;
    record.deadlines.inviteExpiry = null;
    this.broadcast({ type: 'phase', phase: 'complete' });
    this.broadcast({ type: 'result', result });
    this.updateDiscardDeadline(record);
    if (record.countedInProgress) await this.reportInProgress(record, -1);
  }

  // Keeps the home page's in-progress count current. Best effort: a missed
  // report only skews a count.
  private async reportInProgress(record: GameRecord, delta: 1 | -1) {
    record.countedInProgress = delta > 0;
    try {
      await directoryStub(this.env).adjustInProgress(lobbyIdFor(record.settings), delta);
    } catch (error) {
      console.error('Directory report failed', error);
    }
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

  // Persists the record and points the alarm at the earliest deadline.
  private async save() {
    const record = this.record;
    if (!record) return;
    await this.ctx.storage.put(RECORD_KEY, record);
    const next = earliest(record.deadlines);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private snapshotFor(color: Color): GameSnapshot {
    const record = this.requireRecord();
    const clockDeadline = record.deadlines.clock;
    return {
      settings: record.settings,
      invite: record.invite,
      color,
      phase: record.phase,
      moves: record.moves,
      opponent: this.opponentStatus(record, otherColor(color)),
      clock:
        clockDeadline === null
          ? null
          : { color: this.position().turn(), ms: Math.max(0, clockDeadline - Date.now()) },
      result: record.result,
      rematch: record.rematch,
    };
  }

  private opponentStatus(record: GameRecord, color: Color): OpponentStatus {
    if (this.isConnected(color)) return 'connected';
    if (record.deadlines.reconnect[color] !== null) return 'reconnecting';
    return 'gone';
  }

  private isConnected(color: Color): boolean {
    return this.socketsFor(color).length > 0;
  }

  private socketsFor(color: Color): WebSocket[] {
    return this.openSockets().filter((ws) => {
      const who = ws.deserializeAttachment() as Attachment | null;
      return who?.color === color;
    });
  }

  // A socket closed from our side lingers in the list until the client
  // acknowledges, and gets no close callback, so it does not count.
  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
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
    for (const ws of this.openSockets()) {
      if (ws !== except && ws.deserializeAttachment()) this.send(ws, message);
    }
  }

  private broadcastTo(color: Color, message: ServerMessage) {
    for (const ws of this.socketsFor(color)) this.send(ws, message);
  }
}
