// A game against a remote opponent. The server owns the move list and the
// phase; this class mirrors it and sends this player's setup moves.
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type Color,
  type ErrorCode,
  type GameResult,
  type GameSnapshot,
  type LobbyId,
  type MoveRecord,
  type OpponentStatus,
  type RematchMessage,
  type ServerMessage,
  hashEngineReport,
  lobbyIdFor,
} from '@lose-at-chess/protocol';
import { type ConnectionStatus, TypedSocket } from '../net/socket';
import { getClientToken } from '../net/token';
import { GameCore } from './state.svelte';

// Where the post-game rematch negotiation stands, from this player's side.
export type RematchStatus =
  | 'none'
  | 'offered-by-me'
  | 'offered-by-opponent'
  | 'declined'
  | 'withdrawn'
  | 'accepted';

export class OnlineGame extends GameCore {
  myColor = $state<Color | null>(null);
  opponent = $state<OpponentStatus>('gone');
  invite = $state(false);
  connection = $state<ConnectionStatus>('connecting');
  rematch = $state<RematchStatus>('none');
  // The game to move to once a rematch is accepted.
  rematchGameId = $state<string | null>(null);
  // Last server error, cleared on the next accepted move.
  errorMessage = $state<string | null>(null);
  // Errors that end the session: the game is gone, full, or the client is stale.
  fatalError = $state<ErrorCode | null>(null);

  private socket: TypedSocket<ClientMessage, ServerMessage>;
  // SAN of a move sent but not yet echoed by the server.
  private pendingSan: string | null = null;

  constructor(
    gameId: string,
  ) {
    super();
    this.phase = 'waiting';
    this.socket = new TypedSocket(`/ws/game/${gameId}`, {
      onOpen: () => this.socket.send({ type: 'hello', token: getClientToken(), version: PROTOCOL_VERSION }),
      onMessage: (message) => this.handleMessage(message),
      onStatus: (status) => (this.connection = status),
    });
    this.socket.connect();
  }

  isMyTurn = $derived(this.phase === 'setup' && this.myColor === this.turn);
  lobby = $derived<LobbyId>(lobbyIdFor(this.settings));

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

  offerRematch() {
    if (this.rematch === 'offered-by-opponent') {
      this.acceptRematch();
      return;
    }
    this.rematch = 'offered-by-me';
    this.socket.send({ type: 'rematch-offer' });
  }

  acceptRematch() {
    this.socket.send({ type: 'rematch-accept' });
  }

  declineRematch() {
    this.rematch = 'none';
    this.socket.send({ type: 'rematch-decline' });
  }

  // Tells the server we are not coming back, then drops the connection.
  leave() {
    this.socket.send({ type: 'leave' });
    this.disconnect();
  }

  disconnect() {
    this.socket.close();
    this.reset();
  }

  protected override viewer(): Color | null {
    return this.myColor;
  }

  // The result is not final until the server has compared both players'
  // reports, so only report here; `finishGame` runs when `result` arrives.
  protected override onEnginePhaseFinished(result: GameResult) {
    const moves = [...this.engineMoves];
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
      case 'clock':
        this.clockDeadline = { color: message.color, deadline: Date.now() + message.ms };
        return;
      case 'phase':
        if (message.phase === 'engine') this.beginEnginePhase();
        else if (message.phase !== 'complete') this.phase = message.phase;
        if (message.phase !== 'setup') this.clockDeadline = null;
        return;
      case 'result':
        this.finishGame(message.result);
        return;
      case 'opponent-status':
        this.opponent = message.status;
        return;
      case 'rematch':
        this.applyRematch(message);
        return;
      case 'error':
        this.errorMessage = message.message;
        if (message.code === 'no-such-game' || message.code === 'game-full' || message.code === 'version-mismatch') {
          this.fatalError = message.code;
        }
        return;
    }
  }

  private loadSnapshot(snapshot: GameSnapshot) {
    this.startPosition(snapshot.settings);
    this.replaceMoves(snapshot.moves);
    this.timeoutPlies = snapshot.moves.flatMap((move, index) => (move.timeout ? [index + 1] : []));
    this.myColor = snapshot.color;
    this.invite = snapshot.invite;
    this.opponent = snapshot.opponent;
    this.pendingSan = null;
    this.clockDeadline = snapshot.clock && { color: snapshot.clock.color, deadline: Date.now() + snapshot.clock.ms };
    this.rematchGameId = snapshot.rematch.gameId;
    if (snapshot.rematch.gameId) this.rematch = 'accepted';
    else if (snapshot.rematch.offeredBy === null) this.rematch = 'none';
    else this.rematch = snapshot.rematch.offeredBy === snapshot.color ? 'offered-by-me' : 'offered-by-opponent';

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
    if (move.timeout) this.timeoutPlies.push(this.history.length);
  }

  private applyRematch(message: RematchMessage) {
    switch (message.status) {
      case 'offered':
        this.rematch = 'offered-by-opponent';
        return;
      case 'declined':
        this.rematch = 'declined';
        return;
      case 'withdrawn':
        this.rematch = 'withdrawn';
        return;
      case 'accepted':
        this.rematch = 'accepted';
        this.rematchGameId = message.gameId;
        return;
    }
  }
}
