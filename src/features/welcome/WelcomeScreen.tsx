import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../shell/navigation';
import { Button, IconButton } from '../../design/controls';
import { JCodeMark, PauseIcon, PlayIcon, SkipIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { geometry, motion, radius, space, target } from '../../design/tokens';
import { themeFamilies } from '../../design/themes';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore } from '../../core/state/store';
import {
  AsciiWelcome,
  type AsciiMotionState,
  type AsciiWelcomeHandle,
} from './AsciiWelcome';
import {
  createAsciiScene,
  type AsciiRect,
  type AsciiSceneInput,
  type AsciiTitle,
} from './asciiTorus';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Welcome'>;

const ART_MIN = 220;
const ART_MAX = 380;

interface Measurable {
  measureInWindow(
    callback: (x: number, y: number, width: number, height: number) => void,
  ): void;
}

export function WelcomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const { colors, scheme, reduceMotion, familyId } = useTheme();
  const appearance = useAppStore((state) => state.appearance);
  const profileId = useAppStore((state) => state.profileId);
  const [previewFamily, setPreviewFamily] = useState(familyId);
  const [rootSize, setRootSize] = useState({ width, height });
  const [mastheadHeight, setMastheadHeight] = useState<number>(geometry.appBar);
  const [titleRect, setTitleRect] = useState<AsciiRect | null>(null);
  const rootRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const titleWrapRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const asciiRef = useRef<AsciiWelcomeHandle>(null);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [motionState, setMotionState] = useState<AsciiMotionState>({
    opening: !reduceMotion,
    paused: false,
  });
  const compact = width < 380;
  const textScale = Math.min(Math.max(fontScale, 1), 2);
  const artHeight = Math.min(ART_MAX, Math.max(ART_MIN, rootSize.height * 0.38));
  const artTop = insets.top + mastheadHeight;

  const copyIn = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const seamIn = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const actionsIn = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  const measureLater = useCallback(() => {
    if (measureTimer.current) clearTimeout(measureTimer.current);
    measureTimer.current = setTimeout(() => {
      const root = rootRef.current as unknown as Measurable | null;
      if (!root || typeof root.measureInWindow !== 'function') return;
      root.measureInWindow((rootX, rootY, rootWidth, rootHeight) => {
        if (rootWidth > 0 && rootHeight > 0) {
          setRootSize((previous) =>
            Math.abs(previous.width - rootWidth) < 0.5 &&
            Math.abs(previous.height - rootHeight) < 0.5
              ? previous
              : { width: rootWidth, height: rootHeight },
          );
        }
        const title = titleWrapRef.current as unknown as Measurable | null;
        if (!title || typeof title.measureInWindow !== 'function') return;
        title.measureInWindow((x, y, titleWidth, titleHeight) => {
          if (titleWidth < 1 || titleHeight < 1) return;
          setTitleRect((previous) => {
            const next = {
              x: x - rootX,
              y: y - rootY,
              width: titleWidth,
              height: titleHeight,
            };
            if (
              previous &&
              Math.abs(previous.x - next.x) < 0.5 &&
              Math.abs(previous.y - next.y) < 0.5 &&
              Math.abs(previous.width - next.width) < 0.5 &&
              Math.abs(previous.height - next.height) < 0.5
            ) {
              return previous;
            }
            return next;
          });
        });
      });
    }, 0);
  }, []);

  useEffect(() => {
    measureLater();
    return () => {
      if (measureTimer.current) clearTimeout(measureTimer.current);
    };
  }, [measureLater, width, height, fontScale]);

  useEffect(() => {
    copyIn.setValue(reduceMotion ? 1 : 0);
    seamIn.setValue(reduceMotion ? 1 : 0);
    actionsIn.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;
    const animations = [
      Animated.timing(copyIn, {
        toValue: 1,
        delay: motion.welcomeCopyDelay,
        duration: motion.welcomeCopyIn,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(actionsIn, {
        toValue: 1,
        delay: motion.welcomeSeamDelay,
        duration: motion.welcomeSeamIn,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(seamIn, {
        toValue: 1,
        delay: motion.welcomeSeamDelay,
        duration: motion.welcomeSeamIn,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ];
    const group = Animated.parallel(animations);
    group.start();
    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [actionsIn, copyIn, reduceMotion, seamIn]);

  const sceneInput = useMemo<AsciiSceneInput | null>(() => {
    if (rootSize.width < 1 || rootSize.height < 1) return null;
    // The hand-drawn title mask is only used at the default text scale. Large
    // text reflows the headline, and the real heading is the honest source.
    const title: AsciiTitle | null =
      titleRect && rootSize.width >= 340 && textScale <= 1.15
        ? { lines: ['Welcome', 'to jcode.'], rect: titleRect }
        : null;
    return {
      width: rootSize.width,
      height: rootSize.height,
      artTop,
      artHeight,
      title,
    };
  }, [artHeight, artTop, rootSize.height, rootSize.width, textScale, titleRect]);
  const scene = useMemo(
    () => (sceneInput ? createAsciiScene(sceneInput) : null),
    [sceneInput],
  );

  const handleRootLayout = useCallback(() => {
    measureLater();
  }, [measureLater]);

  const handleSkip = useCallback(() => {
    asciiRef.current?.skip();
    copyIn.stopAnimation();
    seamIn.stopAnimation();
    actionsIn.stopAnimation();
    copyIn.setValue(1);
    seamIn.setValue(1);
    actionsIn.setValue(1);
  }, [actionsIn, copyIn, seamIn]);

  const chooseFamily = async (id: string) => {
    setPreviewFamily(id);
    await controller.setThemeFamily(id);
  };

  const setAppearance = async (value: 'system' | 'light' | 'night') => {
    await controller.setAppearance(value);
  };

  const startPreview = () => {
    controller.enterDemo();
    navigation.navigate('Sessions');
  };

  const titleSize =
    Math.min(Math.max(44, width * 0.136), 60) * Math.min(textScale, 1.6);

  return (
    <View
      ref={rootRef}
      style={[styles.screen, { backgroundColor: colors.bg }]}
      onLayout={handleRootLayout}
      testID="welcome-screen"
    >
      <AsciiWelcome
        ref={asciiRef}
        scene={scene}
        reduceMotion={reduceMotion}
        onMotionState={setMotionState}
      />

      <View style={[styles.foreground, { paddingTop: insets.top }]}>
        <View
          style={styles.masthead}
          onLayout={(event) => {
            const next = event.nativeEvent.layout.height;
            setMastheadHeight((previous) =>
              Math.abs(previous - next) < 0.5 ? previous : next,
            );
          }}
        >
          <View style={styles.brand}>
            <JCodeMark size={22} />
            <Text variant="subhead" style={{ marginLeft: space.xs }}>
              jcode
            </Text>
          </View>
          <View style={styles.motionControls}>
            {motionState.opening ? (
              <IconButton
                label="Skip opening animation"
                onPress={handleSkip}
                testID="welcome-skip"
              >
                {({ size, color }) => <SkipIcon size={size} color={color} />}
              </IconButton>
            ) : reduceMotion ? null : (
              <IconButton
                label={motionState.paused ? 'Play animation' : 'Pause animation'}
                onPress={() => asciiRef.current?.togglePause()}
                color={motionState.paused ? 'muted' : 'ink'}
                testID="welcome-motion"
              >
                {({ size, color }) =>
                  motionState.paused ? (
                    <PlayIcon size={size} color={color} />
                  ) : (
                    <PauseIcon size={size} color={color} />
                  )
                }
              </IconButton>
            )}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingHorizontal: compact ? space.lg : space.xl,
              paddingBottom: Math.max(insets.bottom + space.xl, space.xxl),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="welcome-scroll"
        >
          <View style={{ height: artHeight }} pointerEvents="none" />

          <View style={styles.copy}>
            <View
              ref={titleWrapRef}
              style={styles.titleWrap}
              onLayout={measureLater}
            >
              <Animated.View style={{ opacity: copyIn }}>
                <Text
                  variant="welcome"
                  accessibilityRole="header"
                  style={[
                    styles.title,
                    {
                      fontSize: titleSize,
                      lineHeight: titleSize * 1.02,
                    },
                  ]}
                >
                  Welcome{'\n'}to jcode
                  <Text
                    variant="welcome"
                    style={{ color: colors.brand, fontSize: titleSize }}
                  >
                    .
                  </Text>
                </Text>
              </Animated.View>
            </View>

            <Animated.View style={{ opacity: copyIn }}>
              <Text variant="lead" color="muted" style={styles.lede}>
                Pick up your coding sessions from anywhere.
              </Text>
            </Animated.View>
          </View>

          <Animated.View
            style={[styles.seamRow, { opacity: seamIn }]}
            accessibilityElementsHidden={motionState.opening}
            importantForAccessibility={motionState.opening ? 'no-hide-descendants' : 'auto'}
          >
            <View style={[styles.seam, { backgroundColor: colors.accent }]} />
            <Text variant="caption" color="muted" style={{ marginLeft: space.sm }}>
              The server keeps working
            </Text>
          </Animated.View>

          <Animated.View
            style={[styles.actions, { opacity: actionsIn }]}
            pointerEvents={motionState.opening ? 'none' : 'auto'}
            accessibilityElementsHidden={motionState.opening}
            importantForAccessibility={motionState.opening ? 'no-hide-descendants' : 'auto'}
          >
            {profileId ? (
              <Button
                label="Continue to sessions"
                fullWidth
                onPress={() => navigation.navigate('Sessions')}
                testID="welcome-sessions"
              />
            ) : (
              <Button
                label="Get started"
                fullWidth
                onPress={() => navigation.navigate('Connect')}
                testID="welcome-connect"
              />
            )}
            <Button
              label="Preview without connecting"
              variant="secondary"
              fullWidth
              onPress={startPreview}
              accessibilityHint="Opens labelled sample data without contacting a server."
              testID="welcome-preview"
            />
            <Text variant="caption" color="muted" style={styles.actionsNote}>
              Preview uses sample data on this phone. Nothing runs.
            </Text>
          </Animated.View>

          <View style={styles.themeSection}>
            <View style={styles.sectionHeader}>
              <Text variant="small" color="muted">
                Theme
              </Text>
              <Text variant="caption" color="muted">
                {scheme === 'night' ? 'Night' : 'Light'}
              </Text>
            </View>
            <View style={styles.appearanceRow}>
              {(['system', 'light', 'night'] as const).map((value) => {
                const selected = appearance === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    aria-checked={selected}
                    accessibilityLabel={`Appearance ${value}`}
                    onPress={() => void setAppearance(value)}
                    style={[
                      styles.appearanceChip,
                      {
                        borderColor: selected ? colors.brand : colors.line,
                        backgroundColor: selected ? colors.raised : 'transparent',
                      },
                    ]}
                    testID={`appearance-${value}`}
                  >
                    <Text variant="small" weight={selected ? 'semibold' : 'regular'}>
                      {value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Night'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.familyRow}
            >
              {themeFamilies.map((family) => {
                const selected = family.id === previewFamily;
                const swatch = family.modes[scheme];
                return (
                  <Pressable
                    key={family.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    aria-checked={selected}
                    accessibilityLabel={`${family.name} theme`}
                    onPress={() => void chooseFamily(family.id)}
                    style={[
                      styles.familyChip,
                      {
                        borderColor: selected ? colors.brand : colors.line,
                        backgroundColor: selected ? colors.raised : colors.surface,
                      },
                    ]}
                    testID={`theme-${family.id}`}
                  >
                    <View style={styles.swatches}>
                      {[swatch.bg, swatch.brand, swatch.accent].map((color) => (
                        <View key={color} style={[styles.swatch, { backgroundColor: color }]} />
                      ))}
                    </View>
                    <Text
                      variant="caption"
                      weight={selected ? 'semibold' : 'regular'}
                      numberOfLines={1}
                    >
                      {family.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View
              style={[
                styles.previewCard,
                { backgroundColor: colors.surface, borderColor: colors.line },
              ]}
            >
              <View style={styles.previewHeader}>
                <Text variant="small" weight="semibold">
                  Live theme
                </Text>
                <Text variant="caption" color="muted">
                  {scheme === 'night' ? 'Night' : 'Light'}
                </Text>
              </View>
              <View style={styles.previewBody}>
                <View style={[styles.previewUser, { backgroundColor: colors.raised }]}>
                  <Text variant="caption" color="muted">
                    You
                  </Text>
                  <Text variant="small" numberOfLines={2}>
                    Review the reconnect path.
                  </Text>
                </View>
                <View style={[styles.previewAssistant, { borderLeftColor: colors.accent }]}>
                  <Text variant="caption" color="muted">
                    jcode
                  </Text>
                  <Text variant="small" numberOfLines={3}>
                    The daemon owns the turn. The phone only observes and returns.
                  </Text>
                  <View style={[styles.previewCode, { backgroundColor: colors.raised }]}>
                    <Text variant="codeSmall" style={{ color: colors.syntaxKeyword }}>
                      await
                    </Text>
                    <Text variant="codeSmall" style={{ color: colors.ink }}>
                      {' attach({ continue: true })'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.footer}>
            <Text variant="caption" color="muted">
              Theme family and System/Light/Night are phone-wide preferences.
            </Text>
            <Text variant="caption" color="muted">
              JCode Mobile 0.2.1 · preview UI
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  foreground: { flex: 1 },
  masthead: {
    minHeight: geometry.appBar,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  motionControls: { flexDirection: 'row', alignItems: 'center' },
  content: { flexGrow: 1 },
  copy: { marginTop: space.xs },
  titleWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  title: { letterSpacing: -1.4 },
  lede: { marginTop: space.sm, maxWidth: 340 },
  seamRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.md },
  seam: { width: 56, height: StyleSheet.hairlineWidth * 2 },
  actions: { marginTop: space.xl, gap: space.xs },
  actionsNote: { textAlign: 'center' },
  themeSection: { marginTop: space.xxl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appearanceRow: {
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.xs,
    flexWrap: 'wrap',
  },
  appearanceChip: {
    minHeight: target,
    minWidth: target * 1.6,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  familyRow: { gap: space.xs, paddingTop: space.sm, paddingRight: space.lg },
  familyChip: {
    minHeight: 64,
    minWidth: 104,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    justifyContent: 'center',
    gap: space.xxs,
  },
  swatches: { flexDirection: 'row', gap: 2 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  previewCard: {
    marginTop: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space.md,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewBody: { marginTop: space.sm, gap: space.sm },
  previewUser: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    borderRadius: radius.control,
    padding: space.sm,
  },
  previewAssistant: { borderLeftWidth: 2, paddingLeft: space.sm },
  previewCode: {
    marginTop: space.xs,
    borderRadius: radius.control,
    padding: space.xs,
  },
  footer: { marginTop: space.xl, gap: space.xxs },
});
