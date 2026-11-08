import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, useColorScheme, type TextStyle } from 'react-native';

import {
  palettes,
  type AppearancePreference,
  type ColorScheme,
  type Palette,
  type TypeStyle,
  type TypeToken,
  type,
} from './tokens';

interface ThemeValue {
  scheme: ColorScheme;
  colors: Palette;
  reduceMotion: boolean;
  typeStyle: (token: TypeToken) => TextStyle;
  platformGutter: (width: number) => number;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  children,
  preference = 'system',
}: PropsWithChildren<{ preference?: AppearancePreference }>) {
  const systemScheme = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);

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
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'night' : 'light') : preference;

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
    () => ({
      scheme,
      colors: palettes[scheme],
      reduceMotion,
      typeStyle,
      platformGutter,
    }),
    [scheme, reduceMotion, typeStyle, platformGutter],
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
