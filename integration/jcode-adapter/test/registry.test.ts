import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DeviceRegistry } from '../src/registry.ts';
import type { AdapterConfig } from '../src/config.ts';
import { sha256Hex } from '../src/util.ts';

function configFor(stateDir: string): AdapterConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowInsecureBind: false,
    allowedOrigins: [],
    jcodeHome: stateDir,
    daemonSocket: join(stateDir, 'daemon.sock'),
    apiSocket: join(stateDir, 'api.sock'),
    jcodeBin: 'jcode',
    stateDir,
    devicesPath: join(stateDir, 'devices.json'),
    ledgerPath: join(stateDir, 'ledger.json'),
    maxFrameBytes: 4 * 1024 * 1024,
    maxHistoryMessages: 100,
    historyWindow: 10,
    maxHistoryBytes: 1024 * 1024,
    renameTimeoutMs: 8_000,
    logLevel: 'warn',
    faultAfterSend: false,
    trustProxy: false,
    workspaceRoots: [stateDir],
  };
}

test('an outbound frame sees a revocation immediately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jcode-registry-'));
  try {
    const token = 'a'.repeat(64);
    const devices = {
      devices: [
        {
          id: 'device-0001',
          name: 'Phone',
          token_hash: `sha256:${sha256Hex(token)}`,
          paired_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        },
      ],
      pending_codes: [],
    };
    await writeFile(join(dir, 'devices.json'), JSON.stringify(devices), 'utf8');
    const registry = new DeviceRegistry(configFor(dir));
    assert.ok(registry.validateToken(token), 'valid before revocation');

    // Same path, same size is possible in theory: mtime still changes, and the
    // sync gate must not keep serving a removed device.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(join(dir, 'devices.json'), JSON.stringify({ devices: [], pending_codes: [] }), 'utf8');
    assert.equal(registry.validateToken(token), null, 'revoked token rejected on the next frame');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
