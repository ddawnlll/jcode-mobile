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
      <Text variant="caption" color="muted" style={{ minWidth: 58, textAlign: 'right' }}>
        {value.trim() ? `${count === 0 ? 0 : index + 1} of ${count}` : 'Loaded'}
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close find"
        onPress={onClose}
        style={styles.action}
      >
        <CloseIcon size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    borderWidth: 1,
    borderRadius: radius.control,
    marginHorizontal: space.lg,
    marginBottom: space.xs,
    paddingHorizontal: space.sm,
  },
  input: { flex: 1, minHeight: target, fontSize: 16, fontFamily: 'HankenGrotesk-Regular' },
  action: { minWidth: 44, minHeight: target, alignItems: 'center', justifyContent: 'center' },
});
