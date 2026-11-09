/**
 * Bounded image input shared by message and soft-interrupt requests. The
 * daemon wire expects `[media_type, base64]` tuples; the adapter rejects
 * anything outside the supported image types or over budget.
 */
export const MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_CHARS = 20 * 1024 * 1024;
export const MAX_IMAGES = 4;

export function parseImages(
  value: unknown,
): { ok: true; images: Array<[string, string]> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, images: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'images must be an array.' };
  if (value.length > MAX_IMAGES) {
    return { ok: false, error: `Attach at most ${MAX_IMAGES} images.` };
  }
  const images: Array<[string, string]> = [];
  let total = 0;
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) {
      return { ok: false, error: 'Each image must be a media type and base64 payload.' };
    }
    const [mediaType, data] = item;
    if (
      typeof mediaType !== 'string' ||
      typeof data !== 'string' ||
      !/^image\/(png|jpeg|webp|gif)$/i.test(mediaType)
    ) {
      return { ok: false, error: 'Unsupported image type. Use PNG, JPEG, WebP or GIF.' };
    }
    if (data.length > MAX_IMAGE_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      return { ok: false, error: 'An image is too large or is not valid base64.' };
    }
    total += data.length;
    if (total > MAX_TOTAL_IMAGE_CHARS) {
      return { ok: false, error: 'Images are too large for one message.' };
    }
    images.push([mediaType.toLowerCase(), data]);
  }
  return { ok: true, images };
}
