import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  replayMoves,
  setupMovesRemaining,
  setupPhaseIsOver,
  terminalResult,
  tryMove,
} from '@lose-at-chess/protocol';

describe('setup move counting', () => {
  it('counts remaining moves per side', () => {
    expect(setupMovesRemaining(0, 'w', 10)).toBe(10);
    expect(setupMovesRemaining(1, 'w', 10)).toBe(9);
    expect(setupMovesRemaining(1, 'b', 10)).toBe(10);
    expect(setupMovesRemaining(2, 'b', 10)).toBe(9);
    expect(setupMovesRemaining(20, 'w', 10)).toBe(0);
  });

  it('ends the setup phase after both sides have used their moves', () => {
    expect(setupPhaseIsOver(19, 10)).toBe(false);
    expect(setupPhaseIsOver(20, 10)).toBe(true);
  });
});

describe('tryMove', () => {
  it('records a legal move with the mover', () => {
    const chess = new Chess();
    const move = tryMove(chess, 'e2', 'e4');
    expect(move).toMatchObject({ san: 'e4', from: 'e2', to: 'e4', by: 'w', timeout: false });
    expect(chess.turn()).toBe('b');
  });

  it('rejects an illegal move without changing the position', () => {
    const chess = new Chess();
    expect(tryMove(chess, 'e2', 'e5')).toBeNull();
    expect(chess.turn()).toBe('w');
  });

  it('replays a recorded move list to the same position', () => {
    const chess = new Chess();
    const moves = [tryMove(chess, 'e2', 'e4')!, tryMove(chess, 'e7', 'e5')!];
    expect(replayMoves(moves).fen()).toBe(chess.fen());
  });
});

describe('terminalResult', () => {
  it('awards checkmate to the checkmated side', () => {
    const chess = new Chess();
    for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) chess.move(san);
    expect(terminalResult(chess)).toEqual({ outcome: 'checkmate', winner: 'b', reason: 'checkmate' });
  });

  it('reports stalemate as a draw', () => {
    const chess = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(terminalResult(chess)).toEqual({ outcome: 'draw', reason: 'stalemate' });
  });

  it('returns null for an unfinished game', () => {
    expect(terminalResult(new Chess())).toBeNull();
  });
});
