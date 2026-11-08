import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { useTheme, MAX_FONT_SCALE } from './theme';
import type { Palette, TypeToken } from './tokens';

type ColorToken = keyof Palette;

export interface AppTextProps extends TextProps {
  variant?: TypeToken;
  color?: ColorToken;
  /** Tabular figures for times, counts, and plan totals. */
  tabular?: boolean;
  /** Disable platform text scaling only for decorative glyphs. */
  scale?: boolean;
  weight?: 'regular' | 'medium' | 'semibold';
}

export function Text({
  variant = 'body',
  color = 'ink',
  tabular,
  scale = true,
  weight,
  style,
  ...rest
}: AppTextProps) {
  const { colors, typeStyle } = useTheme();
  const base: TextStyle = {
    ...typeStyle(variant),
    ...(weight === 'medium' ? { fontFamily: 'HankenGrotesk-Medium' } : null),
    ...(weight === 'semibold' ? { fontFamily: 'HankenGrotesk-SemiBold' } : null),
  };
  return (
    <RNText
      allowFontScaling={scale}
      maxFontSizeMultiplier={scale ? MAX_FONT_SCALE : undefined}
      {...rest}
      style={[
        base,
        { color: colors[color] },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

/** One-line code/path text. Caller controls wrapping. */
export function MonoText({
  color = 'muted',
  size = 'code',
  style,
  ...rest
}: Omit<AppTextProps, 'variant'> & { size?: 'code' | 'codeSmall' }) {
  return <Text variant={size} color={color} style={style} {...rest} />;
}
