import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STAGE = process.env.JCODE_E2E_DIR ?? join(ROOT, '.staging/e2e');
const DAEMON = process.env.JCODE_E2E_DAEMON_DIR ?? join(ROOT, '.staging/jcode');
const ADAPTER_URL = process.env.E2E_ADAPTER_URL ?? 'http://127.0.0.1:7645';
const WEB_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8091';

function stagingEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    JCODE_HOME: join(DAEMON, 'home'),
    JCODE_RUNTIME_DIR: join(DAEMON, 'run'),
    JCODE_SOCKET: join(DAEMON, 'run', 'jcode.sock'),
    JCODE_API_SOCKET: join(DAEMON, 'run', 'jcode-api.sock'),
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function mintCode(): string {
  if (process.env.E2E_PAIR_CODE) return process.env.E2E_PAIR_CODE.replace(/\D/g, '');
  // `jcode pair` writes the human-readable code to stderr and the QR to the
  // terminal; capture both so the non-interactive path is reliable.
  const result = spawnSync('jcode', ['pair'], { encoding: 'utf8', env: stagingEnv() });
  if (result.error) throw result.error;
  const output = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  const match = /Pairing code:\s*(\d{3})\s*(\d{3})/.exec(output);
  if (!match) throw new Error('Could not read a pairing code from `jcode pair`.');
  return `${match[1]}${match[2]}`;
}

async function waitFor(url: string, label: string): Promise<Response> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become healthy at ${url}.`);
}

export default async function globalSetup(): Promise<void> {
  execFileSync('bash', ['scripts/e2e-prepare.sh'], { stdio: 'inherit', env: process.env });
  await waitFor(`${ADAPTER_URL}/health`, 'e2e adapter');
  await waitFor(`${WEB_URL}/`, 'e2e web server');

  const code = mintCode();
  const deviceId = `e2e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const response = await fetch(`${ADAPTER_URL}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, device_id: deviceId, device_name: 'Playwright E2E' }),
  });
  const payload = (await response.json()) as { ok?: boolean; token?: string; error?: string };
  if (!response.ok || !payload.ok || !payload.token) {
    throw new Error(`E2E pairing failed: ${response.status} ${payload.error ?? 'unknown error'}`);
  }

  const adapter = new URL(ADAPTER_URL);
  const credentials = {
    label: 'E2E staging server',
    host: adapter.hostname,
    port: Number(adapter.port || (adapter.protocol === 'https:' ? 443 : 80)),
    tls: adapter.protocol === 'https:',
    token: payload.token,
    deviceId,
  };
  mkdirSync(STAGE, { recursive: true });
  writeFileSync(join(STAGE, 'credentials.json'), JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
}
