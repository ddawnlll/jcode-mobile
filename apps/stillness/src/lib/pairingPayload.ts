export type PairingPayload = { server: string; code: string };

/** Parse only the explicit, versioned pairing format. Expiry and single use
 * remain authoritative at the adapter, which owns the pairing code. */
export function parsePairingPayload(value: string, now = Date.now()): PairingPayload {
  let link: URL;
  try {
    link = new URL(value.trim());
  } catch {
    throw new Error('This is not a valid pairing link.');
  }
  if (link.protocol !== 'jcode:' || link.hostname !== 'pair' || link.port || link.username || link.password || link.pathname !== '' || link.hash) {
    throw new Error('This is not a supported JCode pairing link.');
  }
  const params = link.searchParams;
  const allowed = new Set(['v', 'url', 'code', 'name', 'expires']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error('This pairing link has invalid fields.');
  }
  if (params.get('v') !== '2') throw new Error('This pairing link uses an unsupported version.');
  const code = params.get('code') ?? '';
  if (!/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(code)) {
    throw new Error('This pairing link has an invalid code.');
  }
  const expires = params.get('expires');
  if (expires !== null) {
    if (!/^\d{1,16}$/.test(expires) || !Number.isSafeInteger(Number(expires))) throw new Error('This pairing link has an invalid expiry.');
    if (Number(expires) <= now) throw new Error('This pairing link has expired.');
  }
  let server: URL;
  try {
    server = new URL(params.get('url') ?? '');
  } catch {
    throw new Error('This pairing link has an invalid server address.');
  }
  if ((server.protocol !== 'https:' && server.protocol !== 'http:') || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
    throw new Error('This pairing link has an invalid server address.');
  }
  const host = server.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  if (server.protocol === 'http:' && !loopback) throw new Error('Remote pairing requires a trusted HTTPS address.');
  return { server: server.origin, code };
}
