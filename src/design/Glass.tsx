import React, { type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

import { useTheme } from './theme';
import { glass as material } from './tokens';

export function colorWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : clean;
  if (full.length !== 6) return hex;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Tidal Glass chrome. At most two of these are visible at once. The opaque
 * sibling is used on web preview, Effects: Reduced, Reduce Transparency, or
 * any platform where live blur is unavailable: controls never sit on a
 * see-through surface without a readable plate.
 */
export function GlassSurface({
  children,
  style,
  intensity = 28,
  testID,
  edge = 'all',
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  testID?: string;
  edge?: 'top' | 'all' | 'none';
}>) {
  const { glass, scheme, colors } = useTheme();
  const edgeStyle: ViewStyle =
    edge === 'top'
      ? { borderTopWidth: material.edgeWidth, borderTopColor: glass.edge }
      : edge === 'all'
        ? { borderWidth: material.edgeWidth, borderColor: glass.edge }
        : {};
  if (!glass.blurEnabled) {
    return (
      <View
        testID={testID}
        accessibilityLabel="Tidal Glass, opaque material"
        style={[style, edgeStyle, { backgroundColor: glass.fallback }]}
      >
        {children}
      </View>
    );
  }
  return (
    <BlurView
      testID={testID}
      accessibilityLabel="Tidal Glass, translucent material"
      intensity={intensity}
      tint={scheme === 'night' ? 'dark' : 'light'}
      style={[style, edgeStyle, { overflow: 'hidden' }]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colorWithAlpha(
              glass.tint,
              scheme === 'night' ? material.night.tintAlpha : material.light.tintAlpha,
            ),
          },
        ]}
      />
      <View style={{ backgroundColor: colors.glassTextPlate }} pointerEvents="none" />
      {children}
    </BlurView>
  );
}

/** A readable plate behind text inside a translucent surface. */
export function GlassPlate({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { glass, colors } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: glass.blurEnabled ? colorWithAlpha(glass.textPlate, 0.72) : colors.surface },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function usesNativeBlur(): boolean {
  return Platform.OS !== 'web';
}
