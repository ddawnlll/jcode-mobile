/**
 * Control plane: reuses JCode's curated harness API through `jcode api-bridge`
 * for inventory, archive/restore, todo state, peek, and file reads. This is the
 * existing server implementation, not a second store.
 *
 * The bridge is deliberately NOT used for session attachment: its subscribe
 * translation does not set `continue_on_disconnect` (verified at
 * jcode@v0.99.1, crates/jcode-harness-api-server/src/translate.rs:603-655).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import type { AdapterConfig } from './config.ts';
import { log } from './config.ts';
import { sleep } from './util.ts';

interface Pending {
  resolve: (frame: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class ControlBridge {
  private readonly config: AdapterConfig;
  private socket: Socket | null = null;
  private child: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private capabilities: string[] = [];
  private connecting: Promise<void> | null = null;
  private helloServer = 'jcode';

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  get daemonVersion(): string {
    return this.helloServer;
  }

  get advertisedCapabilities(): string[] {
    return this.capabilities;
  }

  async ensure(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectWithRetry().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectWithRetry(): Promise<void> {
    const started = Date.now();
    let spawned = false;
    for (;;) {
      try {
        await this.open();
        return;
      } catch (error) {
        if (!spawned && (await this.shouldSpawn())) {
          this.spawnBridge();
          spawned = true;
        }
        if (Date.now() - started > 15_000) {
          throw new Error(
            `Cannot reach the JCode harness bridge at ${this.config.apiSocket}: ${(error as Error).message}`,
          );
        }
        await sleep(150);
      }
    }
  }

  private async shouldSpawn(): Promise<boolean> {
    try {
      await access(this.config.daemonSocket);
      return true;
    } catch {
      return false;
    }
  }

  private spawnBridge(): void {
    if (this.child) return;
    log(this.config, 'info', 'starting jcode api-bridge for the adapter');
    const child = spawn(
      this.config.jcodeBin,
      ['api-bridge', '--api-socket', this.config.apiSocket],
      {
        env: {
          ...process.env,
          JCODE_SOCKET: this.config.daemonSocket,
          JCODE_API_SOCKET: this.config.apiSocket,
          JCODE_HOME: this.config.jcodeHome,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
      },
    );
    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) log(this.config, 'debug', `api-bridge: ${line.slice(0, 300)}`);
    });
    this.child = child;
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (code !== 0) log(this.config, 'warn', `api-bridge exited with code ${code}`);
      this.failAll(new Error('The JCode harness bridge stopped.'));
    });
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.config.apiSocket);
      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('connect', async () => {
        socket.off('error', onError);
        this.socket = socket;
        socket.on('error', (error) => {
          log(this.config, 'warn', `bridge socket error: ${error.message}`);
          this.failAll(error);
        });
        socket.on('close', () => {
          if (this.socket === socket) this.socket = null;
          this.failAll(new Error('The JCode harness bridge disconnected.'));
        });
        const reader = createInterface({ input: socket });
        reader.on('line', (line) => this.onLine(line));
        try {
          const hello = await this.request({ req: 'hello', min_version: 1, max_version: 1, client: 'jcode-mobile-adapter/0.1.0' }, 5000);
          this.capabilities = Array.isArray(hello.capabilities)
            ? (hello.capabilities as string[])
            : [];
          if (typeof hello.server === 'string') this.helloServer = hello.server;
          resolve();
        } catch (error) {
          socket.destroy();
          reject(error as Error);
        }
      });
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const replyTo = typeof parsed.reply_to === 'number' ? parsed.reply_to : undefined;
    if (replyTo === undefined) return;
    const pending = this.pending.get(replyTo);
    if (!pending) return;
    this.pending.delete(replyTo);
    clearTimeout(pending.timer);
    if (parsed.ev === 'error') {
      pending.reject(
        new Error(typeof parsed.message === 'string' ? parsed.message : 'Harness API error'),
      );
      return;
    }
    pending.resolve(parsed);
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async request(
    request: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    if (!this.socket || this.socket.destroyed) throw new Error('Bridge is not connected');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request timed out: ${String(request.req)}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(`${JSON.stringify({ v: 1, id, ...request })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async call<T = Record<string, unknown>>(
    request: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<T> {
    await this.ensure();
    return (await this.request(request, timeoutMs)) as T;
  }

  close(): void {
    this.failAll(new Error('Adapter shutting down'));
    this.socket?.destroy();
    this.socket = null;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }
}
