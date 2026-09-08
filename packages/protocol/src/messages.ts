// Wire protocol between the client and the Game Durable Object. Every
// message is JSON with a `type` discriminator.
import type { GameSettings } from './settings';

export type Color = 'w' | 'b';

// `waiting`: one seat is still empty. The rest match the local game phases.
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

export interface GameSnapshot {
  settings: GameSettings;
  color: Color;
  phase: Phase;
  moves: MoveRecord[];
  opponentConnected: boolean;
  result: GameResult | null;
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
  | ({ type: 'engine-result' } & EngineReport);

// --- Game to Client ---

export type ErrorCode =
  | 'version-mismatch'
  | 'game-full'
  | 'not-your-turn'
  | 'illegal-move'
  | 'wrong-phase'
  | 'bad-report'
  | 'bad-message';

export type ServerMessage =
  | ({ type: 'state' } & GameSnapshot)
  | { type: 'move'; move: MoveRecord }
  | { type: 'phase'; phase: Phase }
  | { type: 'opponent-status'; connected: boolean }
  | { type: 'result'; result: GameResult }
  | { type: 'error'; code: ErrorCode; message: string };
