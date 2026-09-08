import { Chess } from 'chess.js';
import type { Color, GameResult } from '@lose-at-chess/protocol';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function colorName(color: Color): string {
  return color === 'w' ? 'White' : 'Black';
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

const DRAW_DETAILS: Record<string, string> = {
  stalemate: 'Stalemate. Nobody managed to lose.',
  repetition: 'Draw by threefold repetition.',
  'insufficient-material': 'Draw by insufficient material.',
  'fifty-moves': 'Draw by the fifty-move rule.',
};

export function resultText(result: GameResult): { title: string; detail: string } {
  switch (result.outcome) {
    case 'checkmate': {
      const name = colorName(result.winner!);
      return { title: `${name} wins!`, detail: `${name} was checkmated, which is exactly what they wanted.` };
    }
    case 'forfeit': {
      const name = colorName(result.winner!);
      return { title: `${name} wins!`, detail: 'The opponent left the game.' };
    }
    case 'void':
      return { title: 'No result', detail: 'The result could not be verified.' };
    case 'draw':
      return { title: 'Draw', detail: DRAW_DETAILS[result.reason] ?? 'The game is a draw.' };
  }
}
