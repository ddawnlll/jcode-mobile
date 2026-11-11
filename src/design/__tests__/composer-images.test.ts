import {
  sniffImageMime,
  validateComposerImage,
  validateImageSet,
  composerOwnerKey,
  base64ToBytes,
} from '../Composer';
import type { ComposerImage } from '../../core/state/store';

// Minimal valid PNG bytes (signature + start of IHDR).
const PNG = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
  0x52,
];
// Minimal JPEG header.
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
// Minimal GIF header.
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00];
// Minimal WEBP header (RIFF....WEBP).
const WEBP = [
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
];

function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

describe('sniffImageMime', () => {
  it('sniffs png/jpeg/gif/webp magic bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(GIF)).toBe('image/gif');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
  });

  it('returns null for unknown/truncated bytes', () => {
    expect(sniffImageMime([0x00, 0x01, 0x02, 0x03])).toBeNull();
    expect(sniffImageMime([0x89])).toBeNull();
    expect(sniffImageMime(undefined)).toBeNull();
    expect(sniffImageMime([])).toBeNull();
  });
});

describe('validateComposerImage (R17)', () => {
  it('accepts a PNG whose bytes and base64 agree', () => {
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', bytes: PNG, base64: b64(PNG) }),
    ).toEqual({ ok: true, mediaType: 'image/png' });
  });

  it('rejects unknown extensions', () => {
    expect(validateComposerImage({ name: 'doc.pdf', mediaType: 'application/pdf', bytes: PNG }).ok).toBe(false);
    expect(validateComposerImage({ name: 'noext', bytes: PNG }).ok).toBe(false);
  });

  it('rejects MIME/extension mismatch', () => {
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/jpeg', bytes: JPEG }).ok,
    ).toBe(false);
  });

  it('rejects magic-byte mismatch against the declared type', () => {
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', bytes: JPEG }).ok,
    ).toBe(false);
    // Base64-only path sniffs the decoded payload too.
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', base64: b64(JPEG) }).ok,
    ).toBe(false);
  });

  it('rejects non-image bytes and empty payloads (no silent drops)', () => {
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', bytes: [1, 2, 3, 4] }).ok,
    ).toBe(false);
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', bytes: [] }).ok,
    ).toBe(false);
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', base64: '' }).ok,
    ).toBe(false);
  });

  it('rejects per-image oversize from fileSize and from actual bytes', () => {
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', fileSize: 7 * 1024 * 1024 }).ok,
    ).toBe(false);
    expect(
      validateComposerImage({ name: 'photo.png', mediaType: 'image/png', bytes: PNG, fileSize: 6 * 1024 * 1024 }).ok,
    ).toBe(true);
  });

  it('every rejection carries a visible reason', () => {
    const result = validateComposerImage({ name: 'photo.png', mediaType: 'image/png', bytes: JPEG });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(10);
  });
});

describe('validateImageSet (R17)', () => {
  const img = (name: string, extra: Partial<ComposerImage> = {}): ComposerImage => ({
    id: name,
    uri: `file:///${name}`,
    mediaType: 'image/png',
    name,
    base64: b64(PNG),
    ...extra,
  });

  it('accepts a valid set', () => {
    expect(validateImageSet([img('a.png'), img('b.png')])).toEqual({ ok: true, invalidIndexes: [] });
  });

  it('blocks dispatch when an image has no usable payload (never text-only)', () => {
    const result = validateImageSet([img('a.png', { base64: undefined })]);
    expect(result.ok).toBe(false);
    expect(result.invalidIndexes).toEqual([0]);
  });

  it('blocks dispatch when total base64 exceeds the budget', () => {
    const big = (name: string): ComposerImage => ({
      ...img(name),
      base64: 'A'.repeat(2 * 1024 * 1024),
    });
    expect(validateImageSet([big('a.png'), big('b.png')]).ok).toBe(false);
    // Custom budget override is honoured.
    expect(validateImageSet([img('a.png')], { totalBase64BudgetBytes: 4 }).ok).toBe(false);
  });
});

describe('base64 helper', () => {
  it('round-trips bytes', () => {
    expect(Array.from(base64ToBytes(b64(PNG)) ?? [])).toEqual(PNG);
    expect(base64ToBytes('!!!not base64!!!')).toBeNull();
  });
});

describe('owner scoping (R10/R17)', () => {
  it('keys by profile+session+intent so identical session ids across servers differ', () => {
    const a = composerOwnerKey({ profileId: 'A', sessionId: 'same', composeIntentId: 'i' });
    const b = composerOwnerKey({ profileId: 'B', sessionId: 'same', composeIntentId: 'i' });
    expect(a).not.toBe(b);
    expect(composerOwnerKey(undefined)).toBe('');
  });
});
