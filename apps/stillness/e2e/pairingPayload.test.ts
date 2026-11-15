import { describe, expect, test } from 'bun:test';
import { parsePairingPayload } from '../src/lib/pairingPayload';

function payload(url = 'https://adapter.example.com', code = 'ABCD-EFGH-JKLM', extra = '') {
  return `jcode://pair?v=2&url=${encodeURIComponent(url)}&code=${code}${extra}`;
}

describe('pairing payload', () => {
  test('reads a secure origin without pairing', () => {
    expect(parsePairingPayload(payload())).toEqual({ server: 'https://adapter.example.com', code: 'ABCD-EFGH-JKLM' });
    expect(parsePairingPayload(payload('http://[::1]:7646')).server).toBe('http://[::1]:7646');
  });
  test('rejects unknown versions, schemes, codes and duplicated fields', () => {
    for (const value of [payload().replace('v=2', 'v=3'), payload().replace('jcode:', 'https:'), payload('https://adapter.example.com', 'bad'), payload() + '&code=ABCD-EFGH-JKLM', payload() + '&token=secret']) {
      expect(() => parsePairingPayload(value)).toThrow();
    }
  });
  test('rejects unsafe or ambiguous server addresses', () => {
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?a=b', 'file:///etc/passwd']) {
      expect(() => parsePairingPayload(payload(url))).toThrow();
    }
  });
  test('honors explicit expiry while leaving server authoritative', () => {
    expect(() => parsePairingPayload(payload(undefined, undefined, '&expires=999'), 1000)).toThrow('expired');
    expect(() => parsePairingPayload(payload(undefined, undefined, '&expires=invalid'), 1000)).toThrow('expiry');
    expect(parsePairingPayload(payload(undefined, undefined, '&expires=1001'), 1000).code).toBe('ABCD-EFGH-JKLM');
  });
});
