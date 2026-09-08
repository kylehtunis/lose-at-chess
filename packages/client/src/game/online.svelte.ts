// A game against a remote opponent. The server owns the move list and the
// phase; this class mirrors it and sends this player's setup moves.
import {
  type Color,
  type GameResult,
  type GameSnapshot,
  type MoveRecord,
  type ServerMessage,
  hashEngineReport,
} from '@lose-at-chess/protocol';
import { type ConnectionStatus, GameSocket } from '../net/socket';
import { GameCore } from './state.svelte';

export class OnlineGame extends GameCore {
  myColor = $state<Color | null>(null);
  opponentConnected = $state(false);
  connection = $state<ConnectionStatus>('connecting');
  // Last server error, cleared on the next accepted message.
  errorMessage = $state<string | null>(null);

  private socket: GameSocket;
  // SAN of a move sent but not yet echoed by the server.
  private pendingSan: string | null = null;

  // Debug: report one move fewer than actually played, to exercise the
  // server's mismatch handling. Temporary until real mismatches can be studied.
  constructor(
    gameId: string,
    private readonly debugMismatch = false,
  ) {
    super();
    this.phase = 'waiting';
    this.socket = new GameSocket(`/ws/game/${gameId}`, {
      onMessage: (message) => this.handleMessage(message),
      onStatus: (status) => (this.connection = status),
    });
    this.socket.connect();
  }

  isMyTurn = $derived(this.phase === 'setup' && this.myColor === this.turn);

  // Applies the move locally first so the board feels immediate. A server
  // rejection is followed by a snapshot that puts things back.
  tryMove(from: string, to: string): boolean {
    if (!this.isMyTurn) return false;
    const move = this.applyMove(from, to);
    if (!move) return false;
    this.pendingSan = move.san;
    this.socket.send({ type: 'move', from, to, promotion: move.promotion });
    return true;
  }

  disconnect() {
    this.socket.close();
    this.reset();
  }

  // The result is not final until the server has compared both players'
  // reports, so only report here; `finishGame` runs when `result` arrives.
  protected override onEnginePhaseFinished(result: GameResult) {
    const moves = this.debugMismatch ? this.engineMoves.slice(0, -1) : [...this.engineMoves];
    const gameId = this.gameId;
    void hashEngineReport(moves, result).then((hash) => {
      if (!this.isCurrent(gameId, 'engine')) return;
      this.socket.send({ type: 'engine-result', moves, result, hash });
    });
  }

  private handleMessage(message: ServerMessage) {
    switch (message.type) {
      case 'state':
        this.loadSnapshot(message);
        return;
      case 'move':
        this.applyServerMove(message.move);
        return;
      case 'phase':
        if (message.phase === 'engine') this.beginEnginePhase();
        else if (message.phase !== 'complete') this.phase = message.phase;
        return;
      case 'result':
        this.finishGame(message.result);
        return;
      case 'opponent-status':
        this.opponentConnected = message.connected;
        return;
      case 'error':
        this.errorMessage = message.message;
        return;
    }
  }

  private loadSnapshot(snapshot: GameSnapshot) {
    this.startPosition(snapshot.settings);
    this.replaceMoves(snapshot.moves);
    this.myColor = snapshot.color;
    this.opponentConnected = snapshot.opponentConnected;
    this.pendingSan = null;
    if (snapshot.phase === 'complete' && snapshot.result) {
      this.finishGame(snapshot.result);
    } else if (snapshot.phase === 'engine') {
      this.beginEnginePhase();
    } else {
      this.phase = snapshot.phase;
    }
  }

  private applyServerMove(move: MoveRecord) {
    this.errorMessage = null;
    // Our own move already applied optimistically.
    if (move.by === this.myColor && move.san === this.pendingSan) {
      this.pendingSan = null;
      return;
    }
    this.applySan(move.san);
  }
}
