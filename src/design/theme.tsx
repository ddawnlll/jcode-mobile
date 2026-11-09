import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, Platform, useColorScheme, type TextStyle } from 'react-native';

import {
  type AppearancePreference,
  type ColorScheme,
  type EffectsPreference,
  type Palette,
  type TypeStyle,
  type TypeToken,
  type,
} from './tokens';
import { paletteFor, resolveScheme, themeFamily, type ThemeFamily } from './themes';

export interface GlassValue {
  /** False means the opaque fallback must be used. */
  blurEnabled: boolean;
  tint: string;
  tintAlpha: number;
  fallback: string;
  edge: string;
  text: string;
  textPlate: string;
}

interface ThemeValue {
  scheme: ColorScheme;
  colors: Palette;
  familyId: string;
  family: ThemeFamily;
  effects: EffectsPreference;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  glass: GlassValue;
  typeStyle: (token: TypeToken) => TextStyle;
  platformGutter: (width: number) => number;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  children,
  preference = 'system',
  family = 'tidal',
  effects = 'auto',
}: PropsWithChildren<{
  preference?: AppearancePreference;
  family?: string;
  effects?: EffectsPreference;
}>) {
  const systemScheme = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    const transparency = AccessibilityInfo.isReduceTransparencyEnabled?.();
    if (transparency && typeof transparency.then === 'function') {
      transparency
        .then((enabled) => {
          if (mounted) setReduceTransparency(enabled);
        })
        .catch(() => undefined);
    }
    const transparencySubscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => {
      mounted = false;
      subscription.remove();
      transparencySubscription.remove();
    };
  }, []);

  const scheme: ColorScheme = resolveScheme(
    preference,
    systemScheme === 'dark' ? 'night' : 'light',
  );
  const resolvedFamily = themeFamily(family);
  const colors = paletteFor(resolvedFamily.id, scheme);

  const typeStyle = useCallback(
    (token: TypeToken): TextStyle => {
      const style: TypeStyle = type[token];
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        ...(style.letterSpacing !== undefined ? { letterSpacing: style.letterSpacing } : null),
      };
    },
    [],
  );

  const platformGutter = useCallback(
    (width: number) => (width >= 600 ? 24 : 20),
    [],
  );

  const value = useMemo<ThemeValue>(
    () => {
      // Web preview and an explicit Reduced effects choice keep the same
      // geometry but paint the opaque material sibling.
      const blurEnabled =
        effects !== 'reduced' && !reduceTransparency && Platform.OS !== 'web';
      return {
        scheme,
        colors,
        familyId: resolvedFamily.id,
        family: resolvedFamily,
        effects,
        reduceMotion,
        reduceTransparency,
        glass: {
          blurEnabled,
          tint: colors.glassTint,
          tintAlpha: colors.glassTintAlpha,
          fallback: colors.glassFallback,
          edge: colors.glassEdge,
          text: colors.glassText,
          textPlate: colors.glassTextPlate,
        },
        typeStyle,
        platformGutter,
      };
    },
    [
      scheme,
      colors,
      resolvedFamily,
      effects,
      reduceMotion,
      reduceTransparency,
      typeStyle,
      platformGutter,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

/** Font size multiplier cap keeps layouts legible at 200% platform text. */
export const MAX_FONT_SCALE = 2;
