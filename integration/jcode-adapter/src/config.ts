import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AdapterConfig {
  host: string;
  port: number;
  /** TLS terminates here for a real remote server. */
  tlsCert?: string;
  tlsKey?: string;
  /** Explicit, documented development exception. */
  allowInsecureBind: boolean;
  jcodeHome: string;
  daemonSocket: string;
  apiSocket: string;
  jcodeBin: string;
  stateDir: string;
  devicesPath: string;
  ledgerPath: string;
  maxFrameBytes: number;
  maxHistoryMessages: number;
  historyWindow: number;
  maxHistoryBytes: number;
  logLevel: 'debug' | 'info' | 'warn';
  /** Test-only fault injection; disabled unless explicitly set. */
  faultAfterSend: boolean;
  /**
   * Browser origins allowed to call the HTTP endpoints and open a WebSocket.
   * Native clients send no Origin and are unaffected. Loopback origins are
   * allowed by default so the web preview can pair with a local adapter.
   */
  allowedOrigins: string[];
  /**
   * Optional exported web build to serve from the adapter. The browser client
   * then shares an origin with /pair and /ws, so CORS does not apply.
   */
  webDir?: string;
}

function runtimeDir(): string {
  return (
    process.env.JCODE_RUNTIME_DIR ??
    process.env.XDG_RUNTIME_DIR ??
    (process.platform === 'darwin' ? (process.env.TMPDIR ?? tmpdir()) : tmpdir())
  );
}

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listFrom(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(): AdapterConfig {
  const jcodeHome = process.env.JCODE_HOME ?? join(homedir(), '.jcode');
  const stateDir = process.env.JCODE_ADAPTER_STATE ?? join(jcodeHome, 'mobile-adapter');
  const host = process.env.JCODE_ADAPTER_HOST ?? '127.0.0.1';
  return {
    host,
    port: numberFrom(process.env.JCODE_ADAPTER_PORT, 7643),
    tlsCert: process.env.JCODE_ADAPTER_TLS_CERT,
    tlsKey: process.env.JCODE_ADAPTER_TLS_KEY,
    allowInsecureBind: process.env.JCODE_ADAPTER_ALLOW_INSECURE_BIND === '1',
    jcodeHome,
    daemonSocket: process.env.JCODE_SOCKET ?? join(runtimeDir(), 'jcode.sock'),
    apiSocket: process.env.JCODE_API_SOCKET ?? join(stateDir, 'api.sock'),
    jcodeBin: process.env.JCODE_BIN ?? 'jcode',
    stateDir,
    devicesPath: join(jcodeHome, 'devices.json'),
    ledgerPath: join(stateDir, 'delivery-ledger.json'),
    maxFrameBytes: numberFrom(process.env.JCODE_ADAPTER_MAX_FRAME, 4 * 1024 * 1024),
    maxHistoryMessages: numberFrom(process.env.JCODE_ADAPTER_MAX_HISTORY, 5000),
    historyWindow: numberFrom(process.env.JCODE_ADAPTER_HISTORY_WINDOW, 60),
    maxHistoryBytes: numberFrom(process.env.JCODE_ADAPTER_HISTORY_BYTES, 3 * 1024 * 1024),
    logLevel: (process.env.JCODE_ADAPTER_LOG as AdapterConfig['logLevel']) ?? 'info',
    faultAfterSend: process.env.JCODE_ADAPTER_FAULT === 'drop_after_send',
    allowedOrigins: listFrom(process.env.JCODE_ADAPTER_ALLOWED_ORIGINS),
    webDir: process.env.JCODE_ADAPTER_WEB_DIR,
  };
}

/** The web preview runs on a loopback origin; everything else is opt-in. */
export function isAllowedOrigin(config: AdapterConfig, origin: string): boolean {
  let normalizedOrigin = origin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  if (
    config.allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin === normalizedOrigin;
      } catch {
        return false;
      }
    })
  ) {
    return true;
  }
  try {
    const url = new URL(normalizedOrigin);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1')
    ) || (
      url.protocol === 'https:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1')
    );
  } catch {
    return false;
  }
}

export function assertBindable(config: AdapterConfig): void {
  const loopback = config.host === '127.0.0.1' || config.host === '::1' || config.host === 'localhost';
  if (loopback) return;
  if (config.tlsCert && config.tlsKey) return;
  if (config.allowInsecureBind) {
    log(config, 'warn', 'binding a non-loopback interface without TLS: development only');
    return;
  }
  throw new Error(
    'Refusing to bind a non-loopback address without TLS. Provide JCODE_ADAPTER_TLS_CERT and JCODE_ADAPTER_TLS_KEY, or set JCODE_ADAPTER_ALLOW_INSECURE_BIND=1 for an isolated development adapter.',
  );
}

const LEVELS = { debug: 10, info: 20, warn: 30 } as const;

export function log(config: AdapterConfig, level: keyof typeof LEVELS, message: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const suffix = extra ? ` ${JSON.stringify(redact(extra))}` : '';
  process.stderr.write(`[jcode-adapter ${level}] ${message}${suffix}\n`);
}

/** Diagnostics never include bearer tokens, pairing codes, or transcript text. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
      .replace(/\b[0-9a-f]{64}\b/gi, '<token>')
      .replace(/\b\d{6}\b/g, '<code>');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /token|code|authorization|content|message|output/i.test(key) ? '<redacted>' : redact(item);
    }
    return out;
  }
  return value;
}
