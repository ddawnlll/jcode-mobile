import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';

import { Text } from '../../../design/typography';
import { useTheme } from '../../../design/theme';
import { radius, space, target } from '../../../design/tokens';
import type { MessageImage as MessageImageData } from '../../../core/protocol/frames';

function sourceFor(image: MessageImageData): string | null {
  if (image.uri) return image.uri;
  if (image.data) return `data:${image.media_type};base64,${image.data}`;
  return null;
}

export function MessageImage({ image }: { image: MessageImageData }) {
  const { colors } = useTheme();
  const source = sourceFor(image);
  const external = !!source && /^https?:/i.test(source);
  const [allowed, setAllowed] = useState(!external);
  const [failed, setFailed] = useState(false);
  const alt = image.alt || image.label || 'Attached image';
  if (!source) {
    return (
      <View style={[styles.placeholder, { borderColor: colors.line, backgroundColor: colors.raised }]}>
        <Text variant="small" color="muted">
          {alt}
        </Text>
        <Text variant="caption" color="muted">
          Image data unavailable
        </Text>
      </View>
    );
  }
  if (!allowed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Load image: ${alt}`}
        onPress={() => setAllowed(true)}
        style={[styles.placeholder, { borderColor: colors.line, backgroundColor: colors.raised }]}
        testID="message-image-load"
      >
        <Text variant="small" weight="semibold">
          {alt}
        </Text>
        <Text variant="caption" color="muted">
          External image · tap to load
        </Text>
      </Pressable>
    );
  }
  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Image unavailable: ${alt}. Open source`}
        onPress={() => {
          if (source && /^https?:/i.test(source)) void Linking.openURL(source).catch(() => undefined);
        }}
        style={[styles.placeholder, { borderColor: colors.error, backgroundColor: colors.raised }]}
      >
        <Text variant="small" color="error">
          {alt}
        </Text>
        <Text variant="caption" color="muted">
          Image could not be loaded
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.wrap} testID="message-image">
      <Image
        source={{ uri: source }}
        style={[styles.image, { backgroundColor: colors.raised }]}
        contentFit="contain"
        transition={120}
        onError={() => setFailed(true)}
        accessibilityLabel={alt}
      />
      <Text variant="caption" color="muted" style={{ marginTop: space.xxs }} numberOfLines={2}>
        {image.label || alt}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.xs, maxWidth: '100%' },
  image: {
    width: '100%',
    maxWidth: 420,
    height: 220,
    borderRadius: radius.control,
  },
  placeholder: {
    minHeight: target + 32,
    borderWidth: 1,
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.xs,
    justifyContent: 'center',
    gap: space.xxs,
  },
});
