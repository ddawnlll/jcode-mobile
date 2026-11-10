import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { JCodeMark } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { radius, space } from '../../design/tokens';
import { Text } from '../../design/typography';
import type { ReasoningDisplay } from '../../design/themes';

/**
 * Server-exposed reasoning, never a fabricated trace. Hidden keeps the text
 * out of the visible, accessibility and Copy surfaces.
 */
export function ThinkingView({
  phase,
  reasoning,
  display,
  durationSecs,
}: {
  phase: 'none' | 'thinking' | 'working';
  reasoning: string;
  display: ReasoningDisplay;
  durationSecs: number | null;
}) {
  const { colors, reduceMotion } = useTheme();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tilt = useRef(new Animated.Value(0)).current;

  const active = phase === 'thinking';

  useEffect(() => {
    // Compact and Expanded are real display modes too; only Reduce Motion
    // suppresses the active mark (THINK-1).
    if (!active || reduceMotion) {
      tilt.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tilt, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(tilt, { toValue: 0.2, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(tilt, { toValue: 0.75, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(tilt, { toValue: 0, duration: 720, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, tilt]);

  const mark = (size: number, color: string) => (
    <Animated.View style={{ transform: [{ rotate }, { scaleX }, { scaleY }, { translateY }] }}>
      <JCodeMark size={size} color={color} />
    </Animated.View>
  );

  if (display === 'hidden' && !active) {
    if (phase !== 'working') return null;
    return (
      <View style={styles.row} testID="thinking-working" accessibilityLabel="Working">
        <JCodeMark size={18} color={colors.muted} />
        <Text variant="small" color="muted" style={{ marginLeft: space.xs }}>
          Working…
        </Text>
      </View>
    );
  }

  const rotate = tilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-7deg'] });
  const scaleX = tilt.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const scaleY = tilt.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [1, 0.94, 1.03, 1] });
  const translateY = tilt.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  if (display === 'hidden') {
    return (
      <View style={styles.row} testID="thinking-indicator" accessibilityLabel="Model is thinking">
        {mark(20, colors.brand)}
        <Text variant="small" color="muted" style={{ marginLeft: space.xs }}>
          Model is thinking…
        </Text>
      </View>
    );
  }

  if (!reasoning) {
    if (!active && phase !== 'working') return null;
    return (
      <View style={styles.row} testID="thinking-working" accessibilityLabel="Working">
        {active ? mark(20, colors.brand) : <JCodeMark size={18} color={colors.muted} />}
        <Text variant="small" color="muted" style={{ marginLeft: space.xs }}>
          {active ? 'Model is thinking…' : 'Working…'}
        </Text>
      </View>
    );
  }

  const copy = async () => {
    await Clipboard.setStringAsync(reasoning).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <View style={[styles.block, { borderColor: colors.line }]} testID="thinking-indicator">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide thinking' : 'Show thinking'}
        accessibilityState={{ expanded: display === 'expanded' ? true : open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.header}
      >
        {active ? mark(18, colors.brand) : <JCodeMark size={16} color={colors.muted} />}
        <Text variant="small" color="muted" style={{ marginLeft: space.xs, flex: 1 }}>
          {active ? 'Model is thinking…' : 'Thinking'}
          {durationSecs ? ` · ${Math.max(1, Math.round(durationSecs))}s` : ''}
        </Text>
        {display === 'compact' ? (
          <Text variant="caption" color="brand">
            {open ? 'Hide' : 'Show'}
          </Text>
        ) : null}
      </Pressable>
      {display === 'expanded' || open ? (
        <View>
          <Text
            variant="small"
            color="muted"
            selectable
            style={[styles.reasoning, { color: colors.muted }]}
            testID="reasoning-text"
          >
            {reasoning}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied reasoning' : 'Copy reasoning'}
            onPress={() => void copy()}
            style={styles.copy}
          >
            <Text variant="caption" color="muted">
              {copied ? 'Copied' : 'Copy reasoning'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 32, marginTop: space.xs },
  block: { borderWidth: 1, borderRadius: radius.control, marginTop: space.sm, paddingHorizontal: space.sm },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  reasoning: { marginBottom: space.xxs },
  copy: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
