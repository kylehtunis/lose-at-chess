// A typed WebSocket to one Durable Object. Reconnects with backoff after an
// unexpected drop; a close we asked for, or one the server marked as final
// (policy code 1008: version mismatch, full game, and so on), is not retried.
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface SocketHandlers<In> {
  onMessage: (message: In) => void;
  onStatus: (status: ConnectionStatus) => void;
  // Called on every open, including reconnects, to send the handshake.
  onOpen?: () => void;
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const FINAL_CLOSE_CODE = 1008;

export class TypedSocket<Out, In> {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  constructor(
    private readonly path: string,
    private readonly handlers: SocketHandlers<In>,
  ) {}

  connect() {
    this.closedByUs = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}${this.path}`);
    this.ws = ws;
    this.handlers.onStatus('connecting');
    ws.addEventListener('open', () => {
      this.attempts = 0;
      this.handlers.onOpen?.();
      this.handlers.onStatus('open');
    });
    ws.addEventListener('message', (event) => {
      this.handlers.onMessage(JSON.parse(event.data as string) as In);
    });
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onStatus('closed');
      if (this.closedByUs || event.code === FINAL_CLOSE_CODE) return;
      const delay = RETRY_DELAYS_MS[Math.min(this.attempts, RETRY_DELAYS_MS.length - 1)]!;
      this.attempts += 1;
      this.retryTimer = setTimeout(() => this.connect(), delay);
    });
  }

  send(message: Out) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close() {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}
