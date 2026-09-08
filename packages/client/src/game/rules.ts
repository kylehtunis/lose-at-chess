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

// Describes a result for the overlay. With a `viewer`, wins and losses are
// phrased from that player's side.
export function resultText(result: GameResult, viewer: Color | null = null): { title: string; detail: string } {
  const winTitle = (winner: Color) =>
    viewer === null ? `${colorName(winner)} wins!` : viewer === winner ? 'You win!' : 'You lose';
  switch (result.outcome) {
    case 'checkmate': {
      const name = colorName(result.winner!);
      return { title: winTitle(result.winner!), detail: `${name} was checkmated, which is exactly what they wanted.` };
    }
    case 'forfeit': {
      const loser = result.winner === 'w' ? 'b' : 'w';
      return { title: winTitle(result.winner!), detail: `${colorName(loser)} left the game and forfeited.` };
    }
    case 'void':
      return { title: 'No result', detail: 'The result could not be verified.' };
    case 'draw':
      return { title: 'Draw', detail: DRAW_DETAILS[result.reason] ?? 'The game is a draw.' };
  }
}
