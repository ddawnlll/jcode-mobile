import React, { useState } from 'react';
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
}) {
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const canSend = (!!value.trim() || images.length > 0) && !disabledReason;

  const pick = async () => {
    setError(null);
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
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
      if (result.canceled) return;
      let skippedLarge = false;
      const next = result.assets.slice(0, 4 - images.length).flatMap((asset) => {
        if (!asset.uri) return [];
        // Base64 inflates the payload; a single huge original can exhaust the
        // phone or the adapter frame budget. Keep the picker responsive.
        if (typeof asset.fileSize === 'number' && asset.fileSize > 6 * 1024 * 1024) {
          skippedLarge = true;
          return [];
        }
        return [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            uri: asset.uri,
            mediaType: asset.mimeType ?? 'image/jpeg',
            name: asset.fileName ?? `image-${Date.now()}.jpg`,
            base64: asset.base64 ?? undefined,
            alt: asset.fileName ?? 'Attached image',
          },
        ];
      });
      if (next.length) onImagesChange([...images, ...next].slice(0, 4));
      if (skippedLarge) {
        setError('One image was too large to attach. Choose a smaller image or screenshot.');
      }
    } catch {
      setError('Could not open the image picker.');
    } finally {
      setPicking(false);
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
