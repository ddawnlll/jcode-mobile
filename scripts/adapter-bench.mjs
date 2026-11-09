#!/usr/bin/env bun
/**
 * Small, repeatable adapter readiness/latency/memory harness.
 *
 * Usage: bun scripts/adapter-bench.mjs <bun|node> [port]
 * Prints JSON. It starts a disposable adapter with a private state dir and no
 * daemon; every measured request is the HTTP surface used by the phone.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runtime = process.argv[2] === 'node' ? 'node' : 'bun';
const port = Number(process.argv[3] ?? (runtime === 'node' ? 7791 : 7792));
const root = mkdtempSync(join(tmpdir(), `jcode-adapter-bench-${runtime}-`));
const button = process.hrtime.bigint();
const args =
  runtime === 'node'
    ? ['--experimental-strip-types', 'integration/jcode-adapter/src/main.ts']
    : ['integration/jcode-adapter/src/main.ts'];
const child = spawn(runtime, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    JCODE_HOME: join(root, 'home'),
    JCODE_ADAPTER_STATE: join(root, 'state'),
    JCODE_ADAPTER_HOST: '127.0.0.1',
    JCODE_ADAPTER_PORT: String(port),
    JCODE_ADAPTER_ROOTS: root,
    JCODE_ADAPTER_LOG: 'warn',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const url = `http://127.0.0.1:${port}`;
let readyMs = null;
for (let attempt = 0; attempt < 400; attempt += 1) {
  try {
    const response = await fetch(`${url}/health`);
    if (response.ok) {
      readyMs = Number(process.hrtime.bigint() - button) / 1e6;
      break;
    }
  } catch {
    // Not listening yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}
if (readyMs === null) {
  child.kill('SIGKILL');
  console.error(stderr);
  process.exit(1);
}

const rss = () => {
  try {
    const output = spawnSyncRss(child.pid);
    return output;
  } catch {
    return null;
  }
};
function spawnSyncRss(pid) {
  const result = require('node:child_process').spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) ? value * 1024 : null;
}

const latencies = [];
for (let index = 0; index < 200; index += 1) {
  const start = process.hrtime.bigint();
  const response = await fetch(`${url}/health`);
  await response.arrayBuffer();
  latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
}
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.floor(latencies.length * 0.95)];
const p50 = latencies[Math.floor(latencies.length * 0.5)];
const memory = rss();
child.kill('SIGTERM');
await new Promise((resolve) => child.once('exit', resolve));
rmSync(root, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      runtime,
      version:
        runtime === 'bun'
          ? require('node:child_process')
              .execFileSync('bun', ['--version'], { encoding: 'utf8' })
              .trim()
          : process.version,
      coldReadyMs: Number(readyMs.toFixed(1)),
      rssBytes: memory,
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      requests: latencies.length,
    },
    null,
    2,
  ),
);
