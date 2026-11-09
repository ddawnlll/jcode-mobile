import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CloseIcon, SearchIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';

export function FindBar({
  value,
  onChange,
  count,
  index,
  onPrevious,
  onNext,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  count: number;
  index: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.line }]} testID="find-bar">
      <View style={styles.row}>
        <SearchIcon size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel="Find in conversation"
          value={value}
          onChangeText={onChange}
          placeholder="Find in conversation"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: colors.ink }]}
          testID="find-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close find"
          onPress={onClose}
          style={styles.action}
        >
          <CloseIcon size={18} color={colors.muted} />
        </Pressable>
      </View>
      <View style={styles.row}>
        <Text variant="caption" color="muted" style={{ flex: 1 }}>
          {value.trim() ? `${count === 0 ? 0 : index + 1} of ${count}` : 'Loaded history'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous match"
          onPress={onPrevious}
          disabled={count === 0}
          style={styles.action}
          testID="find-previous"
        >
          <Text variant="caption" color={count === 0 ? 'muted' : 'brand'}>
            Prev
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next match"
          onPress={onNext}
          disabled={count === 0}
          style={styles.action}
          testID="find-next"
        >
          <Text variant="caption" color={count === 0 ? 'muted' : 'brand'}>
            Next
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: target,
    flexDirection: 'column',
    gap: 0,
    borderWidth: 1,
    borderRadius: radius.control,
    marginHorizontal: space.lg,
    marginBottom: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  input: { flex: 1, minHeight: target, fontSize: 16, fontFamily: 'HankenGrotesk-Regular' },
  action: { minWidth: 44, minHeight: target, alignItems: 'center', justifyContent: 'center' },
});
