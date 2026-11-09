import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Divider, IconButton, TextAction } from '../../design/controls';
import { BackIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { themeFamilies, type AppearancePreference, type ReasoningDisplay } from '../../design/themes';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore } from '../../core/state/store';

export function AppearanceScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, familyId, scheme } = useTheme();
  const appearance = useAppStore((state) => state.appearance);
  const effects = useAppStore((state) => state.effects);
  const reasoningDisplay = useAppStore((state) => state.reasoningDisplay);

  return (
    <View
      style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}
      testID="appearance-screen"
    >
      <View style={styles.appBar}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          {({ size, color }) => <BackIcon size={size} color={color} />}
        </IconButton>
        <Text variant="body" weight="semibold">
          Appearance
        </Text>
        <View style={{ width: target }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            Theme family
          </Text>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            Eleven families, each with Light and Night. Tidal is the original palette.
          </Text>
          <View style={styles.grid}>
            {themeFamilies.map((family) => {
              const selected = family.id === familyId;
              const palette = family.modes[scheme];
              return (
                <Pressable
                  key={family.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  aria-checked={selected}
                  accessibilityLabel={`${family.name}, ${family.subtitle}`}
                  onPress={() => void controller.setThemeFamily(family.id)}
                  testID={`appearance-family-${family.id}`}
                  style={[
                    styles.familyCard,
                    {
                      borderColor: selected ? colors.brand : colors.line,
                      backgroundColor: selected ? colors.raised : colors.surface,
                    },
                  ]}
                >
                  <View style={[styles.familyPreview, { backgroundColor: palette.bg }]}>
                    <View style={[styles.familyLine, { backgroundColor: palette.ink }]} />
                    <View style={[styles.familyUser, { backgroundColor: palette.raised }]} />
                    <View style={[styles.familyAccent, { backgroundColor: palette.brand }]} />
                    <View style={[styles.familyAccent, { backgroundColor: palette.accent }]} />
                  </View>
                  <Text variant="small" weight={selected ? 'semibold' : 'medium'} numberOfLines={1}>
                    {family.name}
                  </Text>
                  <Text variant="caption" color="muted" numberOfLines={1}>
                    {family.subtitle}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Divider />
        <View style={styles.section}>
          <Text variant="subhead">Appearance</Text>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            Independent from the theme family. System follows this phone.
          </Text>
          <View style={styles.choiceRow}>
            {(['system', 'light', 'night'] as const).map((value) => (
              <Choice
                key={value}
                label={value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Night'}
                selected={appearance === value}
                onPress={() => void controller.setAppearance(value as AppearancePreference)}
                testID={`appearance-mode-${value}`}
              />
            ))}
          </View>
        </View>

        <Divider />
        <View style={styles.section}>
          <Text variant="subhead">Conversation → Thinking</Text>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            Display only. Switching never sends, cancels or changes effort.
          </Text>
          <View style={styles.choiceRow}>
            {(['hidden', 'compact', 'expanded'] as const).map((value) => (
              <Choice
                key={value}
                label={value === 'hidden' ? 'Hidden' : value === 'compact' ? 'Compact' : 'Expanded'}
                selected={reasoningDisplay === value}
                onPress={() => void controller.setReasoningDisplay(value as ReasoningDisplay)}
                testID={`reasoning-${value}`}
              />
            ))}
          </View>
          <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
            Compact is the default. Hidden keeps reasoning out of Copy and accessibility.
          </Text>
        </View>

        <Divider />
        <View style={styles.section}>
          <Text variant="subhead">Effects</Text>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            Reduce Transparency, Reduce Motion and Effects always keep an opaque, readable sibling.
          </Text>
          <View style={styles.choiceRow}>
            <Choice
              label="Auto"
              selected={effects === 'auto'}
              onPress={() => void controller.setEffects('auto')}
              testID="effects-auto"
            />
            <Choice
              label="Reduced"
              selected={effects === 'reduced'}
              onPress={() => void controller.setEffects('reduced')}
              testID="effects-reduced"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Replay welcome"
            onPress={() => navigation.navigate('Welcome' as never)}
            style={styles.replay}
          >
            <Text variant="small" color="brand">
              Replay welcome
            </Text>
          </Pressable>
          <TextAction label="Close" onPress={() => navigation.goBack()} align="center" />
        </View>

        <View style={styles.section}>
          <Text variant="small" color="muted">
            Swatches below show every palette pair. Text is rendered on its own material, not a
            generated approximation.
          </Text>
          <View style={styles.paletteGrid}>
            {themeFamilies.flatMap((family) =>
              (['light', 'night'] as const).map((mode) => {
                const palette = family.modes[mode];
                return (
                  <View
                    key={`${family.id}-${mode}`}
                    testID={`palette-${family.id}-${mode}`}
                    accessibilityLabel={`${family.name} ${mode}`}
                    style={[styles.paletteSwatch, { backgroundColor: palette.bg, borderColor: palette.line }]}
                  >
                    <Text variant="caption" style={{ color: palette.ink }} numberOfLines={1}>
                      {family.name}
                    </Text>
                    <Text variant="caption" style={{ color: palette.muted }} numberOfLines={1}>
                      {mode}
                    </Text>
                    <View style={styles.paletteDots}>
                      {[palette.brand, palette.accent, palette.success, palette.error].map((color) => (
                        <View key={color} style={[styles.paletteDot, { backgroundColor: color }]} />
                      ))}
                    </View>
                  </View>
                );
              }),
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={[
        styles.choice,
        {
          borderColor: selected ? colors.brand : colors.line,
          backgroundColor: selected ? colors.raised : colors.surface,
        },
      ]}
    >
      <Text variant="small" weight={selected ? 'semibold' : 'regular'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  section: { paddingHorizontal: space.lg, paddingVertical: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.md },
  familyCard: {
    width: '47%',
    minHeight: 108,
    borderWidth: 1,
    borderRadius: radius.control,
    padding: space.xs,
    gap: 2,
  },
  familyPreview: {
    height: 46,
    borderRadius: radius.control - 2,
    padding: space.xxs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    overflow: 'hidden',
  },
  familyLine: { width: '42%', height: 5, borderRadius: 3 },
  familyUser: { width: '22%', height: 14, borderRadius: 4 },
  familyAccent: { width: 10, height: 10, borderRadius: 5, marginLeft: 'auto' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  choice: {
    minHeight: target,
    minWidth: target * 1.6,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replay: { minHeight: target, justifyContent: 'center', marginTop: space.xs },
  paletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  paletteSwatch: { width: '30%', minHeight: 72, borderWidth: 1, borderRadius: radius.control, padding: space.xs },
  paletteDots: { flexDirection: 'row', gap: 3, marginTop: 'auto' },
  paletteDot: { width: 10, height: 10, borderRadius: 5 },
});
