import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { JCodeMark } from './icons';
import { useTheme } from './theme';
import { motion, space } from './tokens';
import { Text } from './typography';

/**
 * Pending-only JCode loader. The 1,400 ms orbit matches the authored reference
 * cycle. It runs only while an operation is genuinely pending; Reduce Motion
 * paints the static mark and text.
 */
export function PendingMark({
  label,
  detail,
  size = 44,
  testID = 'pending-mark',
  showDots = true,
}: {
  label: string;
  detail?: string | null;
  size?: number;
  testID?: string;
  showDots?: boolean;
}) {
  const { reduceMotion, colors } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: reduceMotion ? motion.reduced : motion.loaderExit,
      useNativeDriver: true,
    }).start();
  }, [fade, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: motion.loaderOrbit,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View
      style={styles.wrap}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={{ opacity: fade, transform: [{ rotate }] }}>
        <JCodeMark size={size} color={colors.brand} />
      </Animated.View>
      <Text variant="body" weight="semibold" style={{ marginTop: space.sm, textAlign: 'center' }}>
        {label}
      </Text>
      {detail ? (
        <Text variant="small" color="muted" style={{ marginTop: space.xxs, textAlign: 'center' }}>
          {detail}
        </Text>
      ) : null}
      {!reduceMotion && showDots ? <Dots /> : null}
    </View>
  );
}

function Dots() {
  const { colors } = useTheme();
  const values = useMemo(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)], []);
  useEffect(() => {
    const animations = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 160),
          Animated.timing(value, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((2 - index) * 160),
        ]),
      ),
    );
    for (const animation of animations) animation.start();
    return () => {
      for (const animation of animations) animation.stop();
    };
  }, [values]);
  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: colors.muted,
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xl },
  dots: { flexDirection: 'row', gap: space.xxs, marginTop: space.md },
  dot: { width: 5, height: 5, borderRadius: 3 },
});

/** Show the full loading composition only after real pending work exists. */
export function useDelayedPending(pending: boolean, delay = motion.loaderRevealDelay): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [pending, delay]);
  return visible;
}

/** After 8 s of the same operation, recovery controls become appropriate. */
export function useLongWait(pending: boolean, afterMs = 8_000): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!pending) {
      setLong(false);
      return;
    }
    const timer = setTimeout(() => setLong(true), afterMs);
    return () => clearTimeout(timer);
  }, [pending, afterMs]);
  return long;
}
