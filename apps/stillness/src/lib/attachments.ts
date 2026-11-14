/** Read web files or native URIs into the controller's attachment shape. */
import type { DraftAttachment } from './controller';
import type { PickedImageData } from './native-types';
import { isNativeBridgeError, readPickedImage } from './native';
import { validateImage } from './attachmentRules';

export type AttachmentDraft = Omit<DraftAttachment, 'id'>;

function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function attachmentErrorMessage(error: unknown): string {
  if (isNativeBridgeError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function nativeStatusMessage(image: PickedImageData): string {
  switch (image.status) {
    case 'too_large':
      return 'Each image must be 4 MiB or smaller.';
    case 'unsupported_type':
      return 'Only PNG, JPEG, WebP or GIF images can be attached.';
    case 'unreadable':
      return image.error || 'The image could not be read.';
    default:
      return image.error || 'The image could not be read.';
  }
}

export async function attachmentFromFile(file: File): Promise<AttachmentDraft> {
  const problem = validateImage(file.type, file.size);
  if (problem) throw new Error(problem);
  const url = await fileToDataUrl(file);
  const comma = url.indexOf(',');
  const dataBase64 = comma >= 0 ? url.slice(comma + 1) : '';
  if (!dataBase64) throw new Error('The image could not be read.');
  return {
    name: file.name || 'image',
    mediaType: file.type,
    size: file.size,
    dataBase64,
    previewUrl: url,
  };
}

export async function attachmentFromUri(uri: string): Promise<AttachmentDraft> {
  const image = await readPickedImage(uri);
  if (image.status !== 'ok' || !image.base64) {
    throw new Error(nativeStatusMessage(image));
  }
  const mediaType = (image.mimeType ?? 'image/jpeg').toLowerCase();
  const problem = validateImage(mediaType, image.size ?? 0);
  if (problem) throw new Error(problem);
  return {
    name: image.name || 'image',
    mediaType,
    size: image.size ?? 0,
    dataBase64: image.base64,
    previewUrl: dataUrl(mediaType, image.base64),
  };
}
