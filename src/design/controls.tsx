import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from './theme';
import { Text } from './typography';
import { geometry, radius, space, target } from './tokens';
import type { Palette } from './tokens';

export interface IconButtonProps {
  label: string;
  onPress: () => void;
  children: (props: { size: number; color: string }) => React.ReactNode;
  disabled?: boolean;
  /** Visual color; defaults to ink. */
  color?: keyof Palette;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 48x48 icon target with an accessible verb label. */
export function IconButton({
  label,
  onPress,
  children,
  disabled,
  color = 'ink',
  size = 24,
  style,
  testID,
}: IconButtonProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hitSlop={0}
      style={({ pressed }) => [
        styles.iconButton,
        focused && { borderWidth: 2, borderColor: colors.focus },
        pressed && { opacity: 0.96, transform: [{ scale: 0.985 }] },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {children({ size, color: colors[color] })}
    </Pressable>
  );
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  reason?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  loadingLabel,
  fullWidth,
  reason,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const isPrimary = variant === 'primary';
  const bg = disabled ? colors.raised : isPrimary ? colors.brand : colors.raised;
  const fg = disabled ? colors.muted : isPrimary ? colors.onBrand : colors.ink;

  return (
    <View style={fullWidth ? { alignSelf: 'stretch' } : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        testID={testID}
        disabled={disabled || loading}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: bg },
          focused && { borderWidth: 2, borderColor: colors.focus },
          pressed && !disabled ? { transform: [{ scale: 0.985 }] } : null,
          style,
        ]}
      >
        {loading ? (
          <>
            <ActivityIndicator size="small" color={fg} />
            <Text variant="button" style={{ color: fg, marginLeft: space.xs }}>
              {loadingLabel ?? label}
            </Text>
          </>
        ) : (
          <Text variant="button" style={{ color: fg }}>
            {label}
          </Text>
        )}
      </Pressable>
      {disabled && reason ? (
        <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

export interface TextActionProps {
  label: string;
  onPress: () => void;
  color?: keyof Palette;
  disabled?: boolean;
  align?: 'left' | 'center' | 'right';
  testID?: string;
  accessibilityHint?: string;
}

export function TextAction({
  label,
  onPress,
  color = 'brand',
  disabled,
  align = 'left',
  testID,
  accessibilityHint,
}: TextActionProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.textAction,
        { justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' },
        focused && { borderWidth: 2, borderColor: colors.focus },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text variant="button" style={{ color: disabled ? colors.muted : colors[color] }}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  helper?: string;
  /** Rendered inside the bordered field, before the input. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  minHeight?: number;
}

export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, helper, leading, trailing, containerStyle, minHeight, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={containerStyle}>
      <Text variant="small" color={error ? 'error' : 'muted'} style={{ marginBottom: space.xs }}>
        {label}
      </Text>
      <View
        style={[
          styles.field,
          {
            borderColor: error ? colors.error : focused ? colors.focus : colors.control,
            borderWidth: focused ? 2 : 1,
            backgroundColor: colors.surface,
            minHeight: minHeight ?? geometry.searchMin,
          },
        ]}
      >
        {leading ? <View style={{ marginRight: space.xs }}>{leading}</View> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          selectionColor={colors.focus}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            { color: colors.ink, maxHeight: rest.multiline ? geometry.composerMax : undefined },
          ]}
        />
        {trailing ? <View style={{ marginLeft: space.xs }}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text variant="small" color="error" style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: inset }} />;
}

export function Notice({
  children,
  tone = 'neutral',
  action,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'error' | 'warning';
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const borderColor = tone === 'error' ? colors.error : tone === 'warning' ? colors.warning : colors.line;
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: colors.raised, borderColor },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={{ flex: 1 }}>{children}</View>
      {action ? <View style={{ marginLeft: space.sm }}>{action}</View> : null}
    </View>
  );
}

/** Pressable list row with immediate fill feedback and no app shadow. */
export function Row({
  children,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
  disabled,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  disabled?: boolean;
} & Pick<PressableProps, 'accessibilityState'>) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      disabled={disabled || !onPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        { backgroundColor: pressed ? colors.raised : 'transparent' },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function useInputRef() {
  const ref = useRef<TextInput>(null);
  const focus = useCallback(() => ref.current?.focus(), []);
  const blur = useCallback(() => ref.current?.blur(), []);
  return { ref, focus, blur };
}

const styles = StyleSheet.create({
  iconButton: {
    width: target,
    height: target,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  button: {
    minHeight: target,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  textAction: {
    minHeight: target,
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderRadius: radius.control,
  },
  field: {
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
    includeFontPadding: false,
  },
  notice: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
