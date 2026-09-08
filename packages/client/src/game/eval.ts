// Engine evaluations and their display helpers. All evals stored in game state
// are normalized to White's perspective: positive means White is winning.

export type Eval =
  | { type: 'cp'; value: number }
  // Moves to mate. Positive: the perspective side mates. Negative: it gets mated.
  | { type: 'mate'; value: number }
  // The position is already checkmate; `winner` delivered it.
  | { type: 'checkmate'; winner: 'w' | 'b' };

export const EVAL_CLAMP_PAWNS = 10;

export function formatEval(ev: Eval | null): string {
  if (!ev) return '?';
  if (ev.type === 'checkmate') return '#';
  if (ev.type === 'mate') return `M${ev.value}`;
  const pawns = ev.value / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

// Eval as a signed pawn advantage clamped to the bar's range.
export function evalToWhiteAdvantage(ev: Eval | null): number {
  if (!ev) return 0;
  if (ev.type === 'checkmate') return ev.winner === 'w' ? EVAL_CLAMP_PAWNS : -EVAL_CLAMP_PAWNS;
  if (ev.type === 'mate') return ev.value > 0 ? EVAL_CLAMP_PAWNS : -EVAL_CLAMP_PAWNS;
  return Math.max(-EVAL_CLAMP_PAWNS, Math.min(EVAL_CLAMP_PAWNS, ev.value / 100));
}

// Stockfish scores from the side to move's perspective. "mate 0" means the
// side to move has already been checkmated.
export function normalizeEvalToWhite(ev: Eval | null, sideToMove: 'w' | 'b'): Eval | null {
  if (!ev) return null;
  if (ev.type === 'checkmate') return ev;
  if (ev.type === 'mate' && ev.value === 0) {
    return { type: 'checkmate', winner: sideToMove === 'w' ? 'b' : 'w' };
  }
  if (sideToMove === 'w') return ev;
  // `0 - 0` would produce -0, which formats as "-0.0".
  return { type: ev.type, value: ev.value === 0 ? 0 : -ev.value };
}

export function sideToMoveFromFen(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}
