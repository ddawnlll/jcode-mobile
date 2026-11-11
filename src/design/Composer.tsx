import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { GlassSurface } from './Glass';
import { PlusIcon, SendIcon } from './icons';
import { useTheme } from './theme';
import { geometry, radius, space, target } from './tokens';
import { Text } from './typography';
import type { ComposerImage } from '../core/state/store';

/* --------------------------------------------------------- image validation */

export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
/** Total base64 budget across all attachments (adapter frame budget headroom). */
export const IMAGE_TOTAL_BASE64_BUDGET_BYTES = 3 * 1024 * 1024;

export const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export type SniffedMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

function readBytes(
  bytes: Uint8Array | ArrayBuffer | number[] | undefined,
): Uint8Array | null {
  if (!bytes) return null;
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return bytes;
}

/** Magic-byte sniff. Returns null for unknown/unsupported content. */
export function sniffImageMime(
  bytes: Uint8Array | ArrayBuffer | number[] | undefined,
): SniffedMime | null {
  const view = readBytes(bytes);
  if (!view || view.length < 3) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: 47 49 46 38 (GIF8)
  if (
    view.length >= 4 &&
    view[0] === 0x47 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x38
  ) {
    return 'image/gif';
  }
  // WEBP: RIFF at 0, WEBP at 8
  if (
    view.length >= 12 &&
    view[0] === 0x52 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x46 &&
    view[8] === 0x57 &&
    view[9] === 0x45 &&
    view[10] === 0x42 &&
    view[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Decode a base64 string to the sniffable prefix / full payload. */
export function base64ToBytes(base64: string | undefined): Uint8Array | null {
  if (!base64 || typeof base64 !== 'string') return null;
  const cleaned = base64.replace(/\s+/g, '');
  if (cleaned.length === 0) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(cleaned)) return null;
  try {
    const atobFn = (globalThis as unknown as { atob?: (s: string) => string }).atob;
    const btoaFn = (globalThis as unknown as { btoa?: (s: string) => string }).btoa;
    if (typeof atobFn === 'function') {
      const binary = atobFn(cleaned);
      const out = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        out[index] = binary.charCodeAt(index);
      }
      return out;
    }
    if (typeof btoaFn === 'function' && typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(cleaned, 'base64'));
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(cleaned, 'base64'));
    }
  } catch {
    return null;
  }
  return null;
}

export interface ComposerImageInput {
  name?: string;
  mediaType?: string;
  fileSize?: number;
  base64?: string;
  uri?: string;
  /** Raw bytes when available (tests / pre-encoded payloads). */
  bytes?: Uint8Array | ArrayBuffer | number[];
}

export type ImageValidation =
  | { ok: true; mediaType: SniffedMime }
  | { ok: false; reason: string };

/**
 * Validate one attachment (R17). Rejects unknown extensions, MIME/extension
 * mismatches, magic-byte mismatches, missing payloads and over-limit sizes.
 * Never silently drops: every rejection carries a user-visible reason.
 */
export function validateComposerImage(input: ComposerImageInput): ImageValidation {
  const name = input.name ?? '';
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const extensionMime = extension ? IMAGE_EXTENSION_TO_MIME[extension] : undefined;
  if (!extensionMime) {
    return { ok: false, reason: `“${name || 'image'}” has an unknown file type.` };
  }
  const declared = (input.mediaType ?? extensionMime).toLowerCase();
  if (declared !== extensionMime) {
    return {
      ok: false,
      reason: `“${name}” is labelled ${declared} but the file type is ${extensionMime}.`,
    };
  }
  const declaredMime = extensionMime as SniffedMime;
  const rawBytes = readBytes(input.bytes);
  let sniffed: SniffedMime | null = null;
  let payloadBytes: number | null = null;

  if (rawBytes) {
    if (rawBytes.length === 0) {
      return { ok: false, reason: `“${name}” has no readable data.` };
    }
    sniffed = sniffImageMime(rawBytes);
    if (!sniffed) {
      return { ok: false, reason: `“${name}” is not a supported image.` };
    }
    if (sniffed !== declaredMime) {
      return {
        ok: false,
        reason: `“${name}” contents don’t match its ${declaredMime} label.`,
      };
    }
    payloadBytes = rawBytes.length;
  }

  if (typeof input.fileSize === 'number' && input.fileSize > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `“${name}” is larger than 6 MB. Choose a smaller image or screenshot.`,
    };
  }

  if (input.base64 !== undefined) {
    const decoded = base64ToBytes(input.base64);
    if (!decoded || decoded.length === 0) {
      return { ok: false, reason: `“${name}” has no usable image data.` };
    }
    if (!sniffed) {
      sniffed = sniffImageMime(decoded);
      if (!sniffed) {
        return { ok: false, reason: `“${name}” is not a supported image.` };
      }
      if (sniffed !== declaredMime) {
        return {
          ok: false,
          reason: `“${name}” contents don’t match its ${declaredMime} label.`,
        };
      }
    }
    payloadBytes = decoded.length;
  }

  // fileSize/type check against ACTUAL bytes wins over picker metadata when
  // both exist (base64 decode already verified the sniffed type above).
  if (payloadBytes !== null && payloadBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `“${name}” is larger than 6 MB. Choose a smaller image or screenshot.`,
    };
  }

  // A picker result with neither bytes nor base64 is never silently useful:
  // allowlist + declared type only pass when there is at least a URI to load,
  // but the SEND path requires base64 (see validateImageSet).
  if (!rawBytes && input.base64 === undefined && !input.uri) {
    return { ok: false, reason: `“${name}” has no usable image data.` };
  }
  return { ok: true, mediaType: declaredMime };
}

export interface ImageSetValidation {
  ok: boolean;
  reason?: string;
  /** Indexes of images that are individually invalid. */
  invalidIndexes: number[];
}

/**
 * Validate the full send set (R17): every image must be valid AND carry a
 * usable payload (base64), per-image ≤ 6 MB and total base64 within budget.
 * A failure blocks dispatch entirely — never degrades to text-only.
 */
export function validateImageSet(
  images: ComposerImage[],
  opts?: { totalBase64BudgetBytes?: number },
): ImageSetValidation {
  const budget = opts?.totalBase64BudgetBytes ?? IMAGE_TOTAL_BASE64_BUDGET_BYTES;
  const invalidIndexes: number[] = [];
  let totalBase64 = 0;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const result = validateComposerImage({
      name: image.name,
      mediaType: image.mediaType,
      base64: image.base64,
      uri: image.uri,
    });
    if (!result.ok) {
      invalidIndexes.push(index);
      return { ok: false, reason: result.reason, invalidIndexes };
    }
    if (!image.base64) {
      invalidIndexes.push(index);
      return {
        ok: false,
        reason: `“${image.name}” has no usable image data. Remove it before sending.`,
        invalidIndexes,
      };
    }
    totalBase64 += image.base64.length;
    if (totalBase64 > budget) {
      invalidIndexes.push(index);
      return {
        ok: false,
        reason: 'These images are too large to send together. Remove one and try again.',
        invalidIndexes,
      };
    }
  }
  return { ok: true, invalidIndexes };
}

/** Owner scope for a composer instance (R10/R17): profile + session + intent. */
export interface ComposerOwner {
  profileId: string;
  sessionId: string;
  composeIntentId: string;
}

export function composerOwnerKey(owner: ComposerOwner | undefined | null): string {
  return owner ? `${owner.profileId}\0${owner.sessionId}\0${owner.composeIntentId}` : '';
}

export function Composer({
  value,
  onChangeText,
  onSend,
  onBlur,
  images,
  onImagesChange,
  disabledReason,
  working = false,
  placeholder,
  label,
  configStrip,
  onStop,
  showStop = false,
  testID = 'composer',
  owner,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onBlur?: () => void;
  images: ComposerImage[];
  onImagesChange: (images: ComposerImage[]) => void;
  disabledReason?: string;
  working?: boolean;
  placeholder?: string;
  label?: string;
  configStrip?: React.ReactNode;
  onStop?: () => void;
  showStop?: boolean;
  testID?: string;
  /**
   * Owner scope (R10/R17). On switch the pending picker is cancelled via a
   * mount token: late picker completions never leak images into the new
   * session, even if the picker promise resolves after the switch.
   */
  owner?: ComposerOwner;
}) {
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const mountToken = useRef(0);
  const pickingRef = useRef(false);
  const ownerKey = composerOwnerKey(owner);

  // Cancel any in-flight picker on owner switch. Images/draft are preserved
  // by the parent under the old scope — this component never mutates them on
  // a stale completion.
  useEffect(() => {
    mountToken.current += 1;
    if (pickingRef.current) {
      pickingRef.current = false;
      setPicking(false);
    }
  }, [ownerKey]);

  const canSend = (!!value.trim() || images.length > 0) && !disabledReason;

  const pick = async () => {
    const token = mountToken.current + 1;
    mountToken.current = token;
    const stale = () => mountToken.current !== token;
    setError(null);
    pickingRef.current = true;
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
      if (stale()) return;
      if (permission && !permission.granted) {
        setError('Photo access is off. Enable it in system settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, 4 - images.length),
        quality: 0.5,
        base64: true,
      });
      if (stale()) return;
      if (result.canceled) return;
      const assets = result.assets.slice(0, 4 - images.length);
      const next: ComposerImage[] = [];
      const failures: string[] = [];
      for (const asset of assets) {
        const name = asset.fileName ?? `image-${Date.now()}.jpg`;
        if (!asset.uri) {
          failures.push(`“${name}” has no usable image data.`);
          continue;
        }
        const validation = validateComposerImage({
          name,
          mediaType: asset.mimeType ?? undefined,
          fileSize: asset.fileSize ?? undefined,
          base64: asset.base64 ?? undefined,
          uri: asset.uri,
        });
        if (!validation.ok) {
          failures.push(validation.reason);
          continue;
        }
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          mediaType: validation.mediaType,
          name,
          base64: asset.base64 ?? undefined,
          alt: asset.fileName ?? 'Attached image',
        });
      }
      if (stale()) return;
      // Aggregate base64 budget against the existing set + newcomers.
      if (next.length) {
        const combined = validateImageSet([...images, ...next]);
        if (!combined.ok) {
          failures.push(combined.reason ?? 'These images are too large to send together.');
        } else {
          onImagesChange([...images, ...next].slice(0, 4));
        }
      }
      // Zero silent drops: every rejected asset gets a visible reason.
      if (failures.length) {
        setError(
          failures.length === 1
            ? `${failures[0]} Remove it or choose a different image before sending.`
            : `${failures.length} images weren't attached. ${failures[0]} Remove them or choose different images before sending.`,
        );
      }
    } catch {
      if (!stale()) {
        setError('Could not open the image picker.');
      }
    } finally {
      if (mountToken.current === token) {
        pickingRef.current = false;
        setPicking(false);
      }
    }
  };

  return (
    <View testID={testID}>
      {configStrip}
      {images.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
          {images.map((image) => (
            <View key={image.id} style={[styles.thumbWrap, { borderColor: colors.line }]}>
              <View style={[styles.thumb, { backgroundColor: colors.raised }]}>
                <Text variant="caption" color="muted" numberOfLines={2}>
                  {image.name}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${image.name}`}
                onPress={() => onImagesChange(images.filter((entry) => entry.id !== image.id))}
                style={styles.remove}
                testID={`composer-remove-${image.id}`}
              >
                <Text variant="caption" color="error">
                  Remove
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <Text variant="small" color="muted" style={{ marginBottom: space.xxs }}>
        {label ?? (working ? 'Add instruction' : 'Message')}
      </Text>
      <GlassSurface edge="all" style={styles.field} testID="composer-material">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach an image"
          onPress={() => void pick()}
          disabled={picking || images.length >= 4 || !!disabledReason}
          style={styles.attach}
          testID="composer-attach"
        >
          <PlusIcon size={22} color={disabledReason ? colors.muted : colors.brand} />
        </Pressable>
        <TextInput
          accessibilityLabel={working ? 'Add an instruction' : 'Message'}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder ?? (working ? 'A thought, a question, a direction…' : 'Write a message')}
          placeholderTextColor={colors.muted}
          selectionColor={colors.focus}
          multiline
          maxLength={32_000}
          textAlignVertical="top"
          style={[styles.input, { color: colors.glassText }]}
          testID="composer-input"
          onKeyPress={(event) => {
            const native = event.nativeEvent as unknown as { key?: string; modifiers?: string[] };
            if (
              native.key === 'Enter' &&
              native.modifiers?.some((modifier) => modifier === 'meta' || modifier === 'ctrl')
            ) {
              if (canSend) onSend();
            }
          }}
        />
        {showStop && working && onStop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop this turn"
            onPress={onStop}
            style={styles.stop}
            testID="composer-stop"
          >
            <View style={[styles.stopSquare, { backgroundColor: colors.error }]} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={working ? 'Add instruction to this turn' : 'Send message'}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={onSend}
          style={[
            styles.send,
            { backgroundColor: canSend ? colors.brand : colors.raised },
          ]}
          testID="composer-send"
        >
          <SendIcon size={20} color={canSend ? colors.onBrand : colors.muted} />
        </Pressable>
      </GlassSurface>
      <Text variant="caption" color={error || disabledReason ? 'error' : 'muted'} style={{ marginTop: space.xxs }}>
        {error ??
          disabledReason ??
          (working
            ? 'Your server runs the work. Stop stays separate from navigation.'
            : `Your server runs the work.${images.length ? ` ${images.length} image${images.length === 1 ? '' : 's'} attached.` : ''}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: geometry.composerMin,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.control,
    paddingHorizontal: space.xxs,
    paddingVertical: space.xxs,
  },
  attach: { width: target, height: target, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: geometry.composerMax - 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: 'HankenGrotesk-Regular',
    includeFontPadding: false,
  },
  send: {
    width: target,
    height: target,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: { width: target, height: target, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 16, height: 16, borderRadius: 3 },
  images: { gap: space.xs, paddingBottom: space.xs },
  thumbWrap: { width: 132, borderWidth: 1, borderRadius: radius.control, padding: space.xxs },
  thumb: { height: 56, borderRadius: radius.control - 2, padding: space.xxs, justifyContent: 'flex-end' },
  remove: { minHeight: 36, justifyContent: 'center' },
});
