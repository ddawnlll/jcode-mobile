/** Shared image validation rules for the composer and native share intake. */
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_DRAFT_ATTACHMENTS = 4;

export function validateImage(mediaType: string, size: number): string | null {
  const normalized = (mediaType || '').toLowerCase();
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(normalized)) {
    return 'Only PNG, JPEG, WebP or GIF images can be attached.';
  }
  if (size > MAX_IMAGE_BYTES) {
    return 'Each image must be 4 MiB or smaller.';
  }
  return null;
}
