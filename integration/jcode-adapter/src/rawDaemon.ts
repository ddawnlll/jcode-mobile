import { connect, type Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';

export type RawHandler = (event: Record<string, unknown>) => void;

const MAX_LINE_BYTES = 32 * 1024 * 1024;

/** One newline-delimited JSON connection to the internal JCode daemon socket. */
export class RawDaemonConnection {
  private readonly socketPath: string;
  private socket: Socket | null = null;
  private buffer = '';
  private bufferedBytes = 0;
  private readonly decoder = new StringDecoder('utf8');
  private handler: RawHandler | null = null;
  private closed = false;
  private onCloseCallback: (() => void) | null = null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  get isOpen(): boolean {
    return !!this.socket && !this.closed;
  }

  onEvent(handler: RawHandler): void {
    this.handler = handler;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);
      socket.setNoDelay(true);
      socket.once('error', (error) => {
        socket.destroy();
        reject(error);
      });
      socket.once('connect', () => {
        this.socket = socket;
        socket.on('data', (chunk: Buffer) => this.consume(chunk));
        socket.on('error', () => undefined);
        socket.on('close', () => {
          if (this.closed) return;
          this.closed = true;
          this.onCloseCallback?.();
        });
        resolve();
      });
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    this.bufferedBytes += chunk.byteLength;
    if (this.bufferedBytes > MAX_LINE_BYTES) {
      this.close();
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.bufferedBytes = Math.max(0, this.bufferedBytes - Buffer.byteLength(line, 'utf8') - 1);
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        event = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      this.handler?.(event);
    }
  }

  /**
   * Write a frame, waiting for drain when the socket is backpressured (R20).
   * If the peer does not drain within 2s the connection is treated as closed:
   * the request is NOT re-sent, so a request already dispatched is never
   * duplicated. The pending-request waiters settle via the close path.
   */
  send(value: Record<string, unknown>, onBackpressure?: (error: Error) => void): void {
    if (!this.socket || this.closed) throw new Error('Daemon connection is closed');
    const flushed = this.socket.write(`${JSON.stringify(value)}\n`);
    if (flushed) return;
    const socket = this.socket;
    const timer = setTimeout(() => {
      this.closed = true;
      this.onCloseCallback?.();
      socket.destroy();
      onBackpressure?.(new Error('Daemon socket write backpressure timed out.'));
    }, 2000);
    timer.unref?.();
    socket.once('drain', () => clearTimeout(timer));
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }
}
