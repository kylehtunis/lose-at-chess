// Reactive game state shared by local and online play. Subclasses decide
// where setup moves come from and when phases change; this class owns the
// position, the engine phase, and post-game review.
import { Chess } from 'chess.js';
import {
  DEFAULT_SETTINGS,
  type Color,
  type GameResult,
  type GameSettings,
  type MoveRecord,
  type Phase as ServerPhase,
  setupMovesRemaining,
  terminalResult,
  tryMove,
} from '@lose-at-chess/protocol';
import { Engine } from './engine';
import { type Eval, normalizeEvalToWhite, sideToMoveFromFen } from './eval';
import { START_FEN, buildAllFens, resultText } from './rules';

// `config` exists only on the client, before a game is created.
export type Phase = 'config' | ServerPhase;

const ENGINE_MOVE_DELAY_MS = 100;
const ZERO_EVAL: Eval = { type: 'cp', value: 0 };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GameCore {
  phase = $state<Phase>('config');
  settings = $state<GameSettings>(DEFAULT_SETTINGS);
  history = $state<string[]>([]);
  fen = $state(START_FEN);
  turn = $state<Color>('w');
  enginePhaseStartPly = $state<number | null>(null);
  // One eval per engine move, White's perspective.
  engineEvals = $state<(Eval | null)[]>([]);
  // Engine moves in UCI, the basis of the online verification report.
  engineMoves = $state<string[]>([]);
  // The local engine playout has reached a terminal position.
  engineDone = $state(false);
  // Post-game review: every position and the ply currently shown.
  allFens = $state<string[]>([]);
  viewPly = $state<number | null>(null);
  // Post-game analysis: one eval per ply, or null until analysis finishes.
  timelineEvals = $state<(Eval | null)[] | null>(null);
  timelineProgress = $state('');
  result = $state<GameResult | null>(null);
  resultVisible = $state(false);
  // Move clock for the side to move, as an absolute time. Online timed games only.
  clockDeadline = $state<{ color: Color; deadline: number } | null>(null);
  // Plies (1-based) the server played because a clock ran out.
  timeoutPlies = $state<number[]>([]);

  protected chess = new Chess();
  protected engine = new Engine();
  // Bumped on every start and reset so stale async engine work is discarded.
  protected gameId = 0;

  displayFen = $derived(
    this.phase === 'complete' && this.viewPly !== null
      ? (this.allFens[this.viewPly] ?? this.fen)
      : this.fen,
  );

  whiteRemaining = $derived(setupMovesRemaining(this.history.length, 'w', this.settings.setupMoves));
  blackRemaining = $derived(setupMovesRemaining(this.history.length, 'b', this.settings.setupMoves));

  showEvalBar = $derived(this.phase === 'engine' || this.phase === 'complete');

  resultText = $derived(this.result ? resultText(this.result, this.viewer()) : null);

  currentEval = $derived.by((): Eval | null => {
    const lastEngineEval = this.engineEvals.at(-1) ?? ZERO_EVAL;
    if (this.phase === 'engine') return lastEngineEval;
    if (this.phase !== 'complete') return null;
    if (this.timelineEvals === null || this.viewPly === null) return lastEngineEval;
    if (this.viewPly === 0) return ZERO_EVAL;
    return this.timelineEvals[this.viewPly - 1] ?? lastEngineEval;
  });

  reset() {
    this.engine.stop();
    this.gameId += 1;
    this.phase = 'config';
    this.resultVisible = false;
  }

  dismissResult() {
    this.resultVisible = false;
  }

  navigateTo(ply: number) {
    if (this.phase !== 'complete') return;
    const maxPly = this.allFens.length - 1;
    this.viewPly = Math.max(0, Math.min(ply, maxPly));
  }

  // --- For subclasses ---

  // The color this screen belongs to, if it belongs to one player. Online
  // games use it to phrase the result as a win or loss for the viewer.
  protected viewer(): Color | null {
    return null;
  }

  // Clears everything for a fresh game. The caller sets the phase.
  protected startPosition(settings: GameSettings) {
    this.gameId += 1;
    this.chess.reset();
    this.settings = settings;
    this.enginePhaseStartPly = null;
    this.engineEvals = [];
    this.engineMoves = [];
    this.engineDone = false;
    this.allFens = [];
    this.viewPly = null;
    this.timelineEvals = null;
    this.timelineProgress = '';
    this.result = null;
    this.resultVisible = false;
    this.clockDeadline = null;
    this.timeoutPlies = [];
    this.syncFromChess();
  }

  // Applies a setup-phase move if legal. Returns its record, or null.
  protected applyMove(from: string, to: string, promotion?: string): MoveRecord | null {
    if (this.phase !== 'setup') return null;
    const move = tryMove(this.chess, from, to, promotion);
    if (move) this.syncFromChess();
    return move;
  }

  protected applySan(san: string) {
    this.chess.move(san);
    this.syncFromChess();
  }

  protected replaceMoves(moves: MoveRecord[]) {
    this.chess.reset();
    for (const move of moves) this.chess.move(move.san);
    this.syncFromChess();
  }

  protected currentResult(): GameResult | null {
    return terminalResult(this.chess);
  }

  protected beginEnginePhase() {
    this.phase = 'engine';
    this.enginePhaseStartPly = this.history.length;
    this.engineEvals = [];
    this.engineMoves = [];
    this.engineDone = false;
    void this.runEnginePhase();
  }

  // Called when the engine phase reaches a terminal position.
  protected onEnginePhaseFinished(result: GameResult) {
    this.finishGame(result);
  }

  protected finishGame(result: GameResult) {
    this.phase = 'complete';
    this.result = result;
    this.clockDeadline = null;
    this.allFens = buildAllFens(this.history);
    this.viewPly = this.allFens.length - 1;
    this.resultVisible = true;
    void this.buildEvalTimeline();
  }

  protected isCurrent(gameId: number, phase: Phase) {
    return gameId === this.gameId && this.phase === phase;
  }

  // --- Internals ---

  private syncFromChess() {
    this.history = this.chess.history();
    this.fen = this.chess.fen();
    this.turn = this.chess.turn();
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
      const result = this.currentResult();
      if (result) {
        this.engineDone = true;
        this.onEnginePhaseFinished(result);
        return;
      }
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
    this.engineMoves.push(uci);
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

// Both players share one screen; phases advance as soon as the rules say so.
export class LocalGame extends GameCore {
  start(settings: GameSettings) {
    this.startPosition(settings);
    this.phase = 'setup';
  }

  tryMove(from: string, to: string): boolean {
    if (!this.applyMove(from, to)) return false;
    const result = this.currentResult();
    if (result) {
      this.finishGame(result);
    } else if (this.whiteRemaining === 0 && this.blackRemaining === 0) {
      this.beginEnginePhase();
    }
    return true;
  }
}
