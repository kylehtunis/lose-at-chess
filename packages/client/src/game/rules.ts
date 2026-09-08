import { Chess } from 'chess.js';

export type Color = 'w' | 'b';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function colorName(color: Color): string {
  return color === 'w' ? 'White' : 'Black';
}

export function setupMovesRemaining(history: string[], color: Color, setupMovesPerSide: number): number {
  const played = history.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === color).length;
  return Math.max(0, setupMovesPerSide - played);
}

export function setupPhaseIsOver(history: string[], setupMovesPerSide: number): boolean {
  return history.length >= setupMovesPerSide * 2;
}

// FEN after each ply, index 0 being the start position.
export function buildAllFens(history: string[]): string[] {
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const san of history) {
    replay.move(san);
    fens.push(replay.fen());
  }
  return fens;
}

export interface GameResult {
  outcome: 'checkmate' | 'draw';
  // The side that got checkmated, which is the side whose player wins.
  checkmated?: Color;
  title: string;
  detail: string;
}

export function describeResult(chess: Chess): GameResult {
  if (chess.isCheckmate()) {
    const checkmated = chess.turn();
    const name = colorName(checkmated);
    return {
      outcome: 'checkmate',
      checkmated,
      title: `${name} wins!`,
      detail: `${name} was checkmated, which is exactly what they wanted.`,
    };
  }
  let detail = 'The game is a draw.';
  if (chess.isStalemate()) detail = 'Stalemate. Nobody managed to lose.';
  else if (chess.isThreefoldRepetition()) detail = 'Draw by threefold repetition.';
  else if (chess.isInsufficientMaterial()) detail = 'Draw by insufficient material.';
  else if (chess.isDrawByFiftyMoves()) detail = 'Draw by the fifty-move rule.';
  return { outcome: 'draw', title: 'Draw', detail };
}
