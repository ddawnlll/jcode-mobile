import { parseServerAddress } from '../client';

describe('parseServerAddress', () => {
  it('accepts a host and port with TLS by default', () => {
    expect(parseServerAddress('studio.example.net:7643')).toMatchObject({
      ok: true,
      endpoint: { host: 'studio.example.net', port: 7643, tls: true },
    });
  });

  it('accepts explicit secure schemes and strips paths', () => {
    expect(parseServerAddress('https://studio.example.net/path')).toMatchObject({
      ok: true,
      endpoint: { host: 'studio.example.net', port: 7643, tls: true },
    });
    expect(parseServerAddress('wss://studio.example.net:9000')).toMatchObject({
      ok: true,
      endpoint: { host: 'studio.example.net', port: 9000, tls: true },
    });
  });

  it('allows cleartext only for loopback development', () => {
    expect(parseServerAddress('127.0.0.1:7643')).toMatchObject({ ok: true });
    expect(parseServerAddress('ws://localhost:7643')).toMatchObject({
      ok: true,
      endpoint: { host: 'localhost', port: 7643, tls: false },
    });
    const remote = parseServerAddress('ws://studio.example.net:7643');
    expect(remote.ok).toBe(false);
    if (!remote.ok) expect(remote.error).toMatch(/secure address/i);
  });

  it('rejects credentials, empty input, and invalid ports', () => {
    expect(parseServerAddress('')).toMatchObject({ ok: false });
    expect(parseServerAddress('user:pass@host:7643')).toMatchObject({ ok: false });
    expect(parseServerAddress('host:99999')).toMatchObject({ ok: false });
  });

  it('supports bracketed IPv6 hosts', () => {
    expect(parseServerAddress('[::1]:7643')).toMatchObject({
      ok: true,
      endpoint: { host: '::1', port: 7643 },
    });
  });
});
