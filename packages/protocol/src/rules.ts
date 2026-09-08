// Chess-rule helpers shared by the client and the server so both sides agree
// on when the setup phase ends and how a finished position is scored.
import { Chess } from 'chess.js';
import type { Color, GameResult, MoveRecord } from './messages';

export function setupMovesRemaining(pliesPlayed: number, color: Color, setupMovesPerSide: number): number {
  const played = color === 'w' ? Math.ceil(pliesPlayed / 2) : Math.floor(pliesPlayed / 2);
  return Math.max(0, setupMovesPerSide - played);
}

export function setupPhaseIsOver(pliesPlayed: number, setupMovesPerSide: number): boolean {
  return pliesPlayed >= setupMovesPerSide * 2;
}

// Rebuilds a position from a move list.
export function replayMoves(moves: MoveRecord[]): Chess {
  const chess = new Chess();
  for (const move of moves) chess.move(move.san);
  return chess;
}

// Applies a move if legal, returning its record, or null if illegal.
// Promotion defaults to queen so a bare from/to is always enough.
export function tryMove(chess: Chess, from: string, to: string, promotion?: string): MoveRecord | null {
  const by = chess.turn();
  try {
    const move = chess.move({ from, to, promotion: promotion ?? 'q' });
    return { san: move.san, from, to, promotion: move.promotion, by, timeout: false };
  } catch {
    return null;
  }
}

// Scores a finished position. The checkmated side's player wins the meta-game.
// Returns null if the game is not over.
export function terminalResult(chess: Chess): GameResult | null {
  if (chess.isCheckmate()) return { outcome: 'checkmate', winner: chess.turn(), reason: 'checkmate' };
  if (chess.isStalemate()) return { outcome: 'draw', reason: 'stalemate' };
  if (chess.isThreefoldRepetition()) return { outcome: 'draw', reason: 'repetition' };
  if (chess.isInsufficientMaterial()) return { outcome: 'draw', reason: 'insufficient-material' };
  if (chess.isDrawByFiftyMoves()) return { outcome: 'draw', reason: 'fifty-moves' };
  return null;
}

// Uniformly random legal move, played by the server when a clock expires.
// Returns null only if the side to move has no legal moves.
export function randomLegalMove(chess: Chess): MoveRecord | null {
  const legal = chess.moves({ verbose: true });
  const pick = legal[Math.floor(Math.random() * legal.length)];
  if (!pick) return null;
  const move = tryMove(chess, pick.from, pick.to, pick.promotion);
  return move && { ...move, timeout: true };
}
