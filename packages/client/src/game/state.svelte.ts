// Reactive state for a game played on one screen. Both players share the board
// during the setup phase, then the engine plays both sides locally.
import { Chess } from 'chess.js';
import type { SetupMoves } from '@lose-at-chess/protocol';
import { Engine } from './engine';
import { type Eval, normalizeEvalToWhite, sideToMoveFromFen } from './eval';
import {
  type Color,
  type GameResult,
  START_FEN,
  buildAllFens,
  describeResult,
  setupMovesRemaining,
  setupPhaseIsOver,
} from './rules';

export type Phase = 'config' | 'setup' | 'engine' | 'complete';

const ENGINE_MOVE_DELAY_MS = 100;
const ZERO_EVAL: Eval = { type: 'cp', value: 0 };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LocalGame {
  phase = $state<Phase>('config');
  setupMovesPerSide = $state<SetupMoves>(10);
  history = $state<string[]>([]);
  fen = $state(START_FEN);
  turn = $state<Color>('w');
  enginePhaseStartPly = $state<number | null>(null);
  // One eval per engine move, White's perspective.
  engineEvals = $state<(Eval | null)[]>([]);
  // Post-game review: every position and the ply currently shown.
  allFens = $state<string[]>([]);
  viewPly = $state<number | null>(null);
  // Post-game analysis: one eval per ply, or null until analysis finishes.
  timelineEvals = $state<(Eval | null)[] | null>(null);
  timelineProgress = $state('');
  result = $state<GameResult | null>(null);
  resultVisible = $state(false);

  private chess = new Chess();
  private engine = new Engine();
  // Bumped on every start and reset so stale async engine work is discarded.
  private gameId = 0;

  displayFen = $derived(
    this.phase === 'complete' && this.viewPly !== null
      ? (this.allFens[this.viewPly] ?? this.fen)
      : this.fen,
  );

  whiteRemaining = $derived(setupMovesRemaining(this.history, 'w', this.setupMovesPerSide));
  blackRemaining = $derived(setupMovesRemaining(this.history, 'b', this.setupMovesPerSide));

  showEvalBar = $derived(this.phase === 'engine' || this.phase === 'complete');

  currentEval = $derived.by((): Eval | null => {
    const lastEngineEval = this.engineEvals.at(-1) ?? ZERO_EVAL;
    if (this.phase === 'engine') return lastEngineEval;
    if (this.phase !== 'complete') return null;
    if (this.timelineEvals === null || this.viewPly === null) return lastEngineEval;
    if (this.viewPly === 0) return ZERO_EVAL;
    return this.timelineEvals[this.viewPly - 1] ?? lastEngineEval;
  });

  start(setupMoves: SetupMoves) {
    this.gameId += 1;
    this.chess.reset();
    this.setupMovesPerSide = setupMoves;
    this.enginePhaseStartPly = null;
    this.engineEvals = [];
    this.allFens = [];
    this.viewPly = null;
    this.timelineEvals = null;
    this.timelineProgress = '';
    this.result = null;
    this.resultVisible = false;
    this.phase = 'setup';
    this.syncFromChess();
  }

  reset() {
    this.engine.stop();
    this.gameId += 1;
    this.phase = 'config';
    this.resultVisible = false;
  }

  // Setup-phase move from the board. Returns whether the move was legal.
  tryMove(from: string, to: string): boolean {
    if (this.phase !== 'setup') return false;
    try {
      this.chess.move({ from, to, promotion: 'q' });
    } catch {
      return false;
    }
    this.syncFromChess();
    this.afterMove();
    return true;
  }

  dismissResult() {
    this.resultVisible = false;
  }

  navigateTo(ply: number) {
    if (this.phase !== 'complete') return;
    const maxPly = this.allFens.length - 1;
    this.viewPly = Math.max(0, Math.min(ply, maxPly));
  }

  private isCurrent(gameId: number, phase: Phase) {
    return gameId === this.gameId && this.phase === phase;
  }

  private syncFromChess() {
    this.history = this.chess.history();
    this.fen = this.chess.fen();
    this.turn = this.chess.turn();
  }

  private afterMove() {
    if (this.chess.isGameOver()) {
      void this.finishGame();
      return;
    }
    if (this.phase === 'setup' && setupPhaseIsOver(this.history, this.setupMovesPerSide)) {
      this.phase = 'engine';
      this.enginePhaseStartPly = this.history.length;
      void this.runEnginePhase();
    }
  }

  private async runEnginePhase() {
    const gameId = this.gameId;
    await this.engine.reset();
    while (this.isCurrent(gameId, 'engine')) {
      await delay(ENGINE_MOVE_DELAY_MS);
      if (!this.isCurrent(gameId, 'engine')) return;
      const search = await this.engine.bestMove(this.chess.fen());
      if (!this.isCurrent(gameId, 'engine')) return;
      this.applyUciMove(search.move, search.eval);
      this.afterMove();
    }
  }

  private applyUciMove(uci: string, ev: Eval | null) {
    // The search ran with `mover` to move, so its score is from that side's view.
    const mover = this.chess.turn();
    try {
      this.chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {
      console.error('Engine returned an illegal move:', uci, this.chess.fen());
      return;
    }
    this.syncFromChess();
    this.engineEvals.push(normalizeEvalToWhite(ev, mover));
  }

  private async finishGame() {
    this.phase = 'complete';
    this.allFens = buildAllFens(this.history);
    this.viewPly = this.allFens.length - 1;
    this.result = describeResult(this.chess);
    this.resultVisible = true;
    await this.buildEvalTimeline();
  }

  // Evaluates every position so the timeline covers the setup phase too.
  // Engine-phase positions reuse the evals recorded during play.
  private async buildEvalTimeline() {
    const gameId = this.gameId;
    const positions = this.allFens.slice(1);
    const engineOffset = this.enginePhaseStartPly ?? Infinity;
    const evals: (Eval | null)[] = [];

    for (let i = 0; i < positions.length; i++) {
      const fen = positions[i]!;
      const recorded = i >= engineOffset ? this.engineEvals[i - engineOffset] : undefined;
      if (recorded) {
        evals.push(recorded);
        continue;
      }
      this.timelineProgress = `(${i + 1}/${positions.length})`;
      const ev = await this.engine.evaluate(fen);
      if (gameId !== this.gameId) return;
      evals.push(normalizeEvalToWhite(ev, sideToMoveFromFen(fen)));
    }

    this.timelineEvals = evals;
    this.timelineProgress = '';
  }
}
