import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  findNodeHandle,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from './theme';
import { geometry, motion, radius, space } from './tokens';

export type SheetHeadingRef = React.RefObject<React.ComponentRef<typeof View> | null>;

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Focus moves here when the sheet opens. */
  headingRef?: SheetHeadingRef;
  /** Optional element that opened the sheet; focus returns here on close. */
  returnFocusRef?: React.RefObject<React.ComponentRef<typeof View> | null>;
  children: React.ReactNode;
  /** Full height is used at large text sizes automatically. */
  initialFraction?: number;
  testID?: string;
  accessibilityLabel?: string;
}

const AnimatedView = Animated.View;

/**
 * Native bottom sheet: opaque surface, dim scrim, UI-thread direct manipulation
 * on the handle, and a hard 320 ms settling cap. Content scrolls independently;
 * only the handle/header drags the sheet.
 */
export function BottomSheet({
  visible,
  onClose,
  headingRef,
  returnFocusRef,
  children,
  initialFraction = geometry.sheetInitialFraction,
  testID,
  accessibilityLabel,
}: BottomSheetProps) {
  const { colors, reduceMotion } = useTheme();
  const { height, fontScale } = useWindowDimensions();
  const fullScreen = fontScale >= 1.5;
  const sheetHeight = fullScreen ? height : Math.round(height * initialFraction);
  const translateY = useSharedValue(sheetHeight);
  const scrim = useSharedValue(0);
  const [mounted, setMounted] = useState(visible);
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      setMounted(true);
      closing.current = false;
      if (reduceMotion) {
        // No traveling sheet under reduced motion: place it and crossfade.
        translateY.value = 0;
        scrim.value = withTiming(1, { duration: motion.reduced });
      } else {
        translateY.value = sheetHeight;
        translateY.value = withTiming(0, {
          duration: motion.sheet,
          easing: Easing.bezier(...motion.easeOut),
        });
        scrim.value = withTiming(1, { duration: motion.sheet });
      }
    } else if (mounted && !closing.current) {
      closing.current = true;
      if (reduceMotion) {
        translateY.value = 0;
        scrim.value = withTiming(0, { duration: motion.reduced }, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
      } else {
        scrim.value = withTiming(0, { duration: motion.disclosure });
        translateY.value = withTiming(
          sheetHeight,
          { duration: motion.disclosure },
          (finished) => {
            if (finished) runOnJS(setMounted)(false);
          },
        );
      }
    }
  }, [visible, sheetHeight, reduceMotion, mounted, translateY, scrim]);

  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => {
      const handle =
        returnFocusRef?.current ? findNodeHandle(returnFocusRef.current) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 60);
    return () => clearTimeout(timer);
  }, [visible, returnFocusRef]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => {
      const handle = headingRef?.current ? findNodeHandle(headingRef.current) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 120);
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => {
      clearTimeout(timeout);
      back.remove();
    };
  }, [visible, headingRef, onClose]);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    onClose();
  }, [onClose]);

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      const shouldDismiss = event.translationY > sheetHeight * 0.25 || event.velocityY > 900;
      if (shouldDismiss) {
        if (reduceMotion) {
          runOnJS(requestClose)();
          return;
        }
        translateY.value = withTiming(
          sheetHeight,
          { duration: reduceMotion ? motion.reduced : motion.disclosure },
          (finished) => {
            if (finished) runOnJS(requestClose)();
          },
        );
      } else {
        translateY.value = withSpring(0, motion.spring);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} testID={testID} pointerEvents="box-none">
      <AnimatedView
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }, scrimStyle]}
        pointerEvents="none"
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Close sheet"
        onPress={requestClose}
      />
      <AnimatedView
        accessibilityViewIsModal
        accessibilityLabel={accessibilityLabel}
        onAccessibilityEscape={requestClose}
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            backgroundColor: colors.surface,
            borderColor: colors.line,
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={pan}>
          <View style={styles.header}>
            <View style={[styles.grabber, { backgroundColor: colors.line }]} />
            <View style={styles.headerContent}>
              <SheetHeaderSlot headingRef={headingRef} />
            </View>
          </View>
        </GestureDetector>
        <View style={styles.body}>{children}</View>
      </AnimatedView>
    </View>
  );
}

function SheetHeaderSlot({ headingRef }: { headingRef?: SheetHeadingRef }) {
  return <View ref={headingRef} collapsable={false} accessibilityRole="header" style={{ height: 0 }} />;
}

/** Drag handle only; content supplies the visible header. */
export function SheetHeader(props: ViewProps) {
  return <View {...props} />;
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    paddingTop: space.xs,
    paddingHorizontal: space.lg,
    minHeight: 28,
    justifyContent: 'center',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.xs,
  },
  headerContent: { minHeight: 0 },
  body: { flex: 1 },
});
