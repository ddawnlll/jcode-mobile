import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function nowMs(): number {
  return Date.now();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** FNV-1a 64 over the given bytes, matching JCode's history fingerprinter. */
export function fnv1a64(bytes: Buffer, seed = 0xcbf29ce484222325n): bigint {
  let hash = seed;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

/** Short stable fingerprint used as the client reconciliation base. */
export function tailFingerprint(messages: Array<{ role: string; content: string }>): string {
  const tail = messages.slice(-3);
  const digest = createHash('sha256');
  digest.update(String(messages.length));
  for (const message of tail) {
    digest.update('\u0000');
    digest.update(message.role);
    digest.update('\u0000');
    digest.update(message.content.slice(0, 4096));
  }
  return digest.digest('hex').slice(0, 16);
}

export async function writeJsonAtomic(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, path);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function truncate(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
  return { text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(undefined);
  }

  async next(): Promise<T | undefined> {
    if (this.items.length) return this.items.shift();
    if (this.closed) return undefined;
    return new Promise<T | undefined>((resolve) => this.waiters.push(resolve));
  }
}
