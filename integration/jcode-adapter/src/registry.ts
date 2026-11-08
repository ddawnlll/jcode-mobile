/**
 * Device pairing and bearer-token validation against JCode's own device
 * registry (`$JCODE_HOME/devices.json`). `jcode pair` mints the six-digit code
 * into this file; this adapter consumes it and stores only a SHA-256 hash of
 * the issued 64-hex token, exactly like the gateway.
 */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AdapterConfig } from './config.ts';
import { log, redact } from './config.ts';
import { readJson, sha256Hex, writeJsonAtomic } from './util.ts';

export interface PairedDevice {
  id: string;
  name: string;
  token_hash: string;
  apns_token?: string | null;
  paired_at: string;
  last_seen: string;
}

interface PairingCode {
  code: string;
  created_at: string;
  expires_at: string;
}

export interface RegistryFile {
  devices: PairedDevice[];
  pending_codes: PairingCode[];
}

const EMPTY: RegistryFile = { devices: [], pending_codes: [] };

const DEVICE_ID = /^[A-Za-z0-9._-]{8,128}$/;
const DEVICE_NAME = /^[\p{L}\p{N} ._'()\-]{1,64}$/u;

export class DeviceRegistry {
  private readonly config: AdapterConfig;
  private writeChain: Promise<void> = Promise.resolve();
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  private async load(): Promise<RegistryFile> {
    try {
      const raw = await readFile(this.config.devicesPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      return {
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        pending_codes: Array.isArray(parsed.pending_codes) ? parsed.pending_codes : [],
      };
    } catch {
      return { ...EMPTY, devices: [] };
    }
  }

  private async save(registry: RegistryFile): Promise<void> {
    await mkdir(dirname(this.config.devicesPath), { recursive: true, mode: 0o700 });
    await writeFile(this.config.devicesPath, `${JSON.stringify(registry, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  /** Serializes mutations so concurrent pair attempts cannot lose a device. */
  private mutate<T>(work: (registry: RegistryFile) => Promise<T> | T): Promise<T> {
    const run = this.writeChain.then(async () => {
      const registry = await this.load();
      return work(registry);
    });
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  validateToken(token: string): PairedDevice | null {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    return null; // replaced by validateTokenAsync
  }

  async validateTokenAsync(token: string): Promise<PairedDevice | null> {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const registry = await this.load();
    const hash = `sha256:${sha256Hex(token)}`;
    return registry.devices.find((device) => device.token_hash === hash) ?? null;
  }

  async touch(deviceId: string): Promise<void> {
    await this.mutate(async (registry) => {
      const device = registry.devices.find((entry) => entry.id === deviceId);
      if (!device) return;
      device.last_seen = new Date().toISOString();
      await this.save(registry);
    }).catch(() => undefined);
  }

  private allowAttempt(remoteAddress: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(remoteAddress);
    if (!entry || entry.resetAt < now) {
      this.attempts.set(remoteAddress, { count: 1, resetAt: now + 10 * 60_000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= 10;
  }

  async pair(input: {
    code: string;
    deviceId: string;
    deviceName: string;
    remoteAddress: string;
  }): Promise<{ ok: true; token: string; device: PairedDevice } | { ok: false; reason: string }> {
    if (!this.allowAttempt(input.remoteAddress)) {
      return { ok: false, reason: 'Too many pairing attempts. Wait and try again.' };
    }
    const code = input.code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      return { ok: false, reason: 'That pairing code is invalid or expired. Generate a new code on your server.' };
    }
    if (!DEVICE_ID.test(input.deviceId)) return { ok: false, reason: 'Invalid device identifier.' };
    if (!DEVICE_NAME.test(input.deviceName)) return { ok: false, reason: 'Device name must be 1-64 characters.' };

    return this.mutate(async (registry) => {
      const now = new Date().toISOString();
      registry.pending_codes = registry.pending_codes.filter((entry) => entry.expires_at > now);
      const index = registry.pending_codes.findIndex((entry) => entry.code === code);
      if (index === -1) {
        await this.save(registry);
        return {
          ok: false as const,
          reason: 'That pairing code is invalid or expired. Generate a new code on your server.',
        };
      }
      registry.pending_codes.splice(index, 1);

      const token = randomBytes(32).toString('hex');
      const device: PairedDevice = {
        id: input.deviceId,
        name: input.deviceName,
        token_hash: `sha256:${sha256Hex(token)}`,
        apns_token: null,
        paired_at: now,
        last_seen: now,
      };
      registry.devices = registry.devices.filter((entry) => entry.id !== input.deviceId);
      registry.devices.push(device);
      await this.save(registry);
      log(this.config, 'info', 'paired device', { device: redact(device.name), id: device.id });
      return { ok: true as const, token, device };
    });
  }

  async list(): Promise<Array<Pick<PairedDevice, 'id' | 'name' | 'paired_at' | 'last_seen'>>> {
    const registry = await this.load();
    return registry.devices.map(({ id, name, paired_at, last_seen }) => ({ id, name, paired_at, last_seen }));
  }
}

export async function readLedger(path: string): Promise<Record<string, Record<string, number>>> {
  return readJson(path, {});
}

export async function writeLedger(path: string, ledger: Record<string, Record<string, number>>): Promise<void> {
  await writeJsonAtomic(path, ledger);
}
