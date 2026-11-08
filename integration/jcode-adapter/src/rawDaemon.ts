import { connect, type Socket } from 'node:net';

export type RawHandler = (event: Record<string, unknown>) => void;

const MAX_LINE_BYTES = 32 * 1024 * 1024;

/** One newline-delimited JSON connection to the internal JCode daemon socket. */
export class RawDaemonConnection {
  private readonly socketPath: string;
  private socket: Socket | null = null;
  private buffer = '';
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
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.close();
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
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

  send(value: Record<string, unknown>): void {
    if (!this.socket || this.closed) throw new Error('Daemon connection is closed');
    this.socket.write(`${JSON.stringify(value)}\n`);
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }
}
