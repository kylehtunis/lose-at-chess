// Thin UCI wrapper around Stockfish running in a Web Worker.
import { ENGINE_HASH_MB, ENGINE_THREADS, SEARCH_DEPTH } from '@lose-at-chess/protocol';
import type { Eval } from './eval';

// Served from the site's own origin: Web Workers must be same-origin.
const STOCKFISH_URL = '/stockfish/stockfish-nnue-16-single.js';

export interface SearchResult {
  move: string;
  eval: Eval | null;
}

export class Engine {
  private worker: Worker;
  private pendingSearch: ((result: SearchResult) => void) | null = null;
  private pendingReady: (() => void)[] = [];
  private lastEval: Eval | null = null;

  constructor() {
    this.worker = new Worker(STOCKFISH_URL);
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.send('uci');
  }

  private send(command: string) {
    this.worker.postMessage(command);
  }

  private waitReady(): Promise<void> {
    return new Promise((resolve) => {
      this.pendingReady.push(resolve);
      this.send('isready');
    });
  }

  private handleMessage(line: unknown) {
    if (typeof line !== 'string') return;
    if (line === 'readyok') {
      this.pendingReady.shift()?.();
      return;
    }
    if (line.startsWith('info') && line.includes(' score ')) {
      const mate = line.match(/score mate (-?\d+)/);
      const cp = line.match(/score cp (-?\d+)/);
      if (mate?.[1]) this.lastEval = { type: 'mate', value: parseInt(mate[1], 10) };
      else if (cp?.[1]) this.lastEval = { type: 'cp', value: parseInt(cp[1], 10) };
    }
    if (line.startsWith('bestmove') && this.pendingSearch) {
      const move = line.split(' ')[1] ?? '';
      const resolve = this.pendingSearch;
      this.pendingSearch = null;
      resolve({ move, eval: this.lastEval });
    }
  }

  // Clears all search state so a fresh engine phase is reproducible on any
  // machine: no hash-table carryover from earlier games, refreshes, or analysis.
  async reset(): Promise<void> {
    this.send('ucinewgame');
    this.send(`setoption name Hash value ${ENGINE_HASH_MB}`);
    this.send(`setoption name Threads value ${ENGINE_THREADS}`);
    await this.waitReady();
  }

  async bestMove(fen: string): Promise<SearchResult> {
    await this.waitReady();
    return new Promise((resolve) => {
      this.lastEval = null;
      this.pendingSearch = resolve;
      this.send(`position fen ${fen}`);
      this.send(`go depth ${SEARCH_DEPTH}`);
    });
  }

  // Eval from the side to move's perspective, as Stockfish reports it.
  async evaluate(fen: string): Promise<Eval | null> {
    const result = await this.bestMove(fen);
    return result.eval;
  }

  stop() {
    this.send('stop');
    this.pendingSearch = null;
  }
}
