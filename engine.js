// Thin UCI wrapper around Stockfish running in a Web Worker.
// Search is depth-limited only, so results do not depend on the host CPU speed.
const SEARCH_DEPTH = 15;

class Engine {
  constructor() {
    this.worker = new Worker('lib/stockfish/stockfish-nnue-16-single.js');
    this.pendingResolve = null;
    this.lastEval = null;
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.ready = new Promise((resolve) => { this.readyResolve = resolve; });
    this.send('uci');
    this.send('isready');
  }

  send(command) {
    this.worker.postMessage(command);
  }

  handleMessage(line) {
    if (typeof line !== 'string') return;
    if (line === 'readyok') {
      this.readyResolve();
      return;
    }
    if (line.startsWith('info') && line.includes(' score ')) {
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      if (mateMatch) {
        const moves = parseInt(mateMatch[1], 10);
        this.lastEval = { type: 'mate', value: moves };
      } else if (cpMatch) {
        this.lastEval = { type: 'cp', value: parseInt(cpMatch[1], 10) };
      }
    }
    if (line.startsWith('bestmove') && this.pendingResolve) {
      const uciMove = line.split(' ')[1];
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve({ move: uciMove, eval: this.lastEval });
    }
  }

  async bestMove(fen) {
    await this.ready;
    return new Promise((resolve) => {
      this.lastEval = null;
      this.pendingResolve = resolve;
      this.send(`position fen ${fen}`);
      this.send(`go depth ${SEARCH_DEPTH}`);
    });
  }

  async evaluate(fen) {
    const result = await this.bestMove(fen);
    return result.eval;
  }

  stop() {
    this.send('stop');
    this.pendingResolve = null;
  }
}
