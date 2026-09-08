// Wire protocol between the client and the Durable Objects. Every message is
// JSON with a `type` discriminator.
import type { GameSettings, LobbyId } from './settings';

export type Color = 'w' | 'b';

// `waiting`: one seat is still empty, or a seated player has not connected
// yet. The rest match the local game phases.
export type Phase = 'waiting' | 'setup' | 'engine' | 'complete';

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  by: Color;
  // The server played a random move because the mover's clock expired.
  timeout: boolean;
}

export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'insufficient-material'
  | 'fifty-moves'
  | 'forfeit'
  | 'void';

export interface GameResult {
  outcome: 'checkmate' | 'draw' | 'forfeit' | 'void';
  // The player who wins the meta-game. Absent for draws and void results.
  winner?: Color;
  reason: ResultReason;
}

// `reconnecting`: the opponent's socket dropped and their seat is being held.
// `gone`: they left for good (or never arrived).
export type OpponentStatus = 'connected' | 'reconnecting' | 'gone';

// The move clock for the side to move in a timed game. `ms` is the time left
// when the message was sent; clients count down from there.
export interface ClockState {
  color: Color;
  ms: number;
}

export interface RematchState {
  // Who has an open rematch offer, if anyone.
  offeredBy: Color | null;
  // The game both players moved to once an offer was accepted.
  gameId: string | null;
}

export interface GameSnapshot {
  settings: GameSettings;
  // Invite games offer "back to home" after the game rather than re-queueing.
  invite: boolean;
  color: Color;
  phase: Phase;
  moves: MoveRecord[];
  opponent: OpponentStatus;
  clock: ClockState | null;
  result: GameResult | null;
  rematch: RematchState;
}

// --- Client to Game ---

// What a client saw when it played the engine phase locally. `moves` are in
// UCI notation; `hash` is `hashEngineReport(moves, result)`.
export interface EngineReport {
  moves: string[];
  result: GameResult;
  hash: string;
}

export type ClientMessage =
  | { type: 'hello'; token: string; version: number }
  | { type: 'move'; from: string; to: string; promotion?: string }
  | ({ type: 'engine-result' } & EngineReport)
  | { type: 'rematch-offer' }
  | { type: 'rematch-accept' }
  | { type: 'rematch-decline' }
  // Explicit departure: skips the reconnect window.
  | { type: 'leave' };

// --- Game to Client ---

export type ErrorCode =
  | 'version-mismatch'
  | 'no-such-game'
  | 'game-full'
  | 'not-your-turn'
  | 'illegal-move'
  | 'wrong-phase'
  | 'bad-report'
  | 'bad-lobby'
  | 'bad-message';

export type RematchMessage =
  // The opponent offered, declined, or withdrew (by leaving).
  | { type: 'rematch'; status: 'offered' | 'declined' | 'withdrawn' }
  | { type: 'rematch'; status: 'accepted'; gameId: string };

export type ServerMessage =
  | ({ type: 'state' } & GameSnapshot)
  | { type: 'move'; move: MoveRecord }
  | ({ type: 'clock' } & ClockState)
  | { type: 'phase'; phase: Phase }
  | { type: 'opponent-status'; status: OpponentStatus }
  | { type: 'result'; result: GameResult }
  | RematchMessage
  | { type: 'error'; code: ErrorCode; message: string };

// --- Lobby ---

export type LobbyClientMessage =
  | { type: 'queue'; token: string; lobby: LobbyId; version: number }
  | { type: 'cancel' };

export type LobbyServerMessage =
  | { type: 'matched'; gameId: string }
  | { type: 'error'; code: ErrorCode; message: string };

// --- Directory ---

export interface LobbyCounts {
  waiting: number;
  inProgress: number;
}

export type DirectoryServerMessage = { type: 'counts'; counts: Record<LobbyId, LobbyCounts> };

// --- HTTP ---

export interface CreateInviteRequest {
  token: string;
  settings: GameSettings;
}

export interface CreateInviteResponse {
  gameId: string;
}
