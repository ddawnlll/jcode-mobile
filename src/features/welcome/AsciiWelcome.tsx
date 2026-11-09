import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { fonts } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import {
  ASCII_FRAME_MS,
  ASCII_IDLE_FRAME_MS,
  ASCII_OPEN_MS,
  asciiWelcomeFrame,
} from './asciiTorus';

const COLS = 40;
const ROWS = 18;

/**
 * The welcome art. It assembles in 1.6 seconds from the same character grid as
 * the design reference, then keeps a slow turn while the screen is focused and
 * the app is active. Reduce Motion gets the settled frame immediately.
 */
export function AsciiWelcome({ fontSize }: { fontSize: number }) {
  const { colors, reduceMotion } = useTheme();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [frame, setFrame] = useState(() =>
    asciiWelcomeFrame({
      cols: COLS,
      rows: ROWS,
      elapsedMs: reduceMotion ? ASCII_OPEN_MS : 0,
      tick: 0,
      reducedMotion: reduceMotion,
    }),
  );
  const elapsedRef = useRef(reduceMotion ? ASCII_OPEN_MS : 0);
  const tickRef = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setActive(next !== 'background');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      elapsedRef.current = ASCII_OPEN_MS;
      setFrame(
        asciiWelcomeFrame({
          cols: COLS,
          rows: ROWS,
          elapsedMs: ASCII_OPEN_MS,
          tick: tickRef.current,
          reducedMotion: true,
        }),
      );
      return;
    }
    if (!focused || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = Date.now();
    const step = () => {
      const now = Date.now();
      elapsedRef.current += Math.max(0, now - last);
      last = now;
      const elapsed = elapsedRef.current;
      setFrame(
        asciiWelcomeFrame({
          cols: COLS,
          rows: ROWS,
          elapsedMs: elapsed,
          tick: tickRef.current,
          reducedMotion: false,
        }),
      );
      tickRef.current += 1;
      if (!cancelled) {
        timer = setTimeout(step, elapsed < ASCII_OPEN_MS ? ASCII_FRAME_MS : ASCII_IDLE_FRAME_MS);
      }
    };
    step();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, focused, reduceMotion]);

  return (
    <View
      style={styles.wrap}
      testID="welcome-ascii"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {frame.map((line, index) => (
        <Text
          key={index}
          allowFontScaling={false}
          selectable={false}
          style={[
            styles.line,
            {
              color: colors.brand,
              fontSize,
              lineHeight: Math.round(fontSize * 1.12),
            },
          ]}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  line: { fontFamily: fonts.mono, letterSpacing: 0, includeFontPadding: false },
});
