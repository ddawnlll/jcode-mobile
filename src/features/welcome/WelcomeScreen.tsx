import React, { useEffect, useRef, useState } from 'react';
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
import { Button, TextAction } from '../../design/controls';
import { JCodeMark } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { motion, radius, space, target, type } from '../../design/tokens';
import { themeFamilies } from '../../design/themes';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore } from '../../core/state/store';
import { AsciiWelcome } from './AsciiWelcome';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Welcome'>;

export function WelcomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const { colors, scheme, reduceMotion, familyId } = useTheme();
  const appearance = useAppStore((state) => state.appearance);
  const profileId = useAppStore((state) => state.profileId);
  const [previewFamily, setPreviewFamily] = useState(familyId);
  const compact = width < 380;
  const textScale = Math.min(Math.max(fontScale, 1), 2);
  const asciiSize = width < 340 ? 10 : width < 380 ? 11 : 13;

  const copyIn = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const seamIn = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      copyIn.setValue(1);
      seamIn.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(copyIn, {
        toValue: 1,
        delay: motion.welcomeCopyDelay,
        duration: motion.welcomeCopyIn,
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
    ]).start();
  }, [copyIn, reduceMotion, seamIn]);

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

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          <JCodeMark size={22} />
          <Text variant="subhead" style={{ marginLeft: space.xs }}>
            jcode
          </Text>
        </View>
        {profileId ? (
          <TextAction label="Sessions" onPress={() => navigation.navigate('Sessions')} />
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + space.xl, space.xxl) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <AsciiWelcome fontSize={asciiSize} />

        <Animated.View style={{ opacity: copyIn }}>
          <Text
            variant="welcome"
            accessibilityRole="header"
            style={[
              styles.title,
              {
                fontSize: (compact ? 46 : type.welcome.fontSize) * Math.min(textScale, 1.6),
                lineHeight: (compact ? 50 : type.welcome.lineHeight) * Math.min(textScale, 1.6),
              },
            ]}
          >
            Your work.{'\n'}In reach.
          </Text>
        </Animated.View>

        <Animated.View style={{ opacity: seamIn, flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.seam, { backgroundColor: colors.accent }]} />
          <Text variant="caption" color="muted" style={{ marginLeft: space.sm }}>
            The server keeps working
          </Text>
        </Animated.View>

        <Text variant="lead" color="muted" style={styles.truth}>
          Your server runs JCode. This is where you stay close to the work.
        </Text>

        <View style={styles.actions}>
          <Button
            label="Connect a server"
            fullWidth
            onPress={() => navigation.navigate('Connect')}
            testID="welcome-connect"
          />
          <Button
            label="Preview the app"
            variant="secondary"
            fullWidth
            onPress={startPreview}
            accessibilityHint="Opens labelled sample data without contacting a server."
            testID="welcome-preview"
          />
          <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
            Preview uses sample data on this phone. Nothing runs.
          </Text>
        </View>

        <View style={[styles.previewCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
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

        <Text variant="small" color="muted" style={{ marginTop: space.xl }}>
          Appearance
        </Text>
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

        <Text variant="small" color="muted" style={{ marginTop: space.lg }}>
          Theme family
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.familyRow}>
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
                <Text variant="caption" weight={selected ? 'semibold' : 'regular'} numberOfLines={1}>
                  {family.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Text variant="caption" color="muted">
            Theme family and System/Light/Night are phone-wide preferences.
          </Text>
          <Text variant="caption" color="muted">
            JCode Mobile 0.2.0 · preview UI
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    minHeight: 56,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  content: { paddingHorizontal: space.lg, paddingTop: space.md },
  title: { marginTop: space.md },
  seam: { width: 56, height: StyleSheet.hairlineWidth * 2 },
  truth: { marginTop: space.lg, maxWidth: 420 },
  actions: { marginTop: space.xl, gap: space.xs },
  previewCard: {
    marginTop: space.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space.md,
  },
  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewBody: { marginTop: space.sm, gap: space.sm },
  previewUser: { alignSelf: 'flex-end', maxWidth: '86%', borderRadius: radius.control, padding: space.sm },
  previewAssistant: { borderLeftWidth: 2, paddingLeft: space.sm },
  previewCode: { marginTop: space.xs, borderRadius: radius.control, padding: space.xs },
  appearanceRow: { flexDirection: 'row', gap: space.xs, marginTop: space.xs, flexWrap: 'wrap' },
  appearanceChip: {
    minHeight: target,
    minWidth: target * 1.6,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  familyRow: { gap: space.xs, paddingTop: space.xs, paddingRight: space.lg },
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
  footer: { marginTop: space.xxl, gap: space.xxs },
});
