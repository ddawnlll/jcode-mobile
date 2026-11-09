import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { CheckIcon, ChevronRightIcon, StopIcon, WorkIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { motion, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import type { ToolRow } from '../../core/state/store';

function operation(name: string): string {
  const lower = name.toLowerCase();
  if (/bash|shell|exec|command/.test(lower)) return 'Command';
  if (/read/.test(lower)) return 'Read file';
  if (/write|edit|patch|replace/.test(lower)) return 'Edit file';
  if (/search|grep|find/.test(lower)) return 'Search';
  if (/todo|plan/.test(lower)) return 'Plan';
  return name;
}

function targetLabel(row: ToolRow): string {
  if (!row.input || typeof row.input !== 'object') return '';
  const input = row.input as Record<string, unknown>;
  const path =
    (typeof input.path === 'string' && input.path) ||
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.query === 'string' && input.query) ||
    (typeof input.command === 'string' && input.command) ||
    '';
  return path.split('\n')[0].slice(0, 100);
}

function stateLabel(row: ToolRow): string {
  if (row.state === 'running') return 'Running';
  if (row.state === 'failed') return 'Error';
  return 'Completed';
}

export function WorkRail({
  rows,
  working,
  onOpen,
  onStop,
}: {
  rows: ToolRow[];
  working: boolean;
  onOpen: () => void;
  onStop: () => void;
}) {
  const { colors, reduceMotion } = useTheme();
  const sweep = useRef(new Animated.Value(0)).current;
  const recent = rows.slice(-3);

  useEffect(() => {
    if (!working || reduceMotion) {
      sweep.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: motion.loaderOrbit,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep, working]);

  if (recent.length === 0 && !working) return null;

  return (
    <View style={[styles.rail, { borderTopColor: colors.line }]} testID="work-rail">
      {working && !reduceMotion ? (
        <View style={[styles.sweepTrack, { backgroundColor: colors.line }]} pointerEvents="none">
          <Animated.View
            style={[
              styles.sweep,
              {
                backgroundColor: colors.brand,
                transform: [
                  {
                    translateX: sweep.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-120, 420],
                    }),
                  },
                ],
                opacity: sweep.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.55, 0.15] }),
              },
            ]}
          />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${recent.length} tool calls. Open session work`}
        onPress={onOpen}
        style={styles.rows}
      >
        {recent.map((row) => (
          <ToolRailRow key={row.callId} row={row} />
        ))}
        {recent.length === 0 ? (
          <View style={styles.row}>
            <WorkIcon size={18} color={colors.success} />
            <Text variant="small" color="muted" style={{ marginLeft: space.xs }}>
              Work is starting…
            </Text>
          </View>
        ) : null}
        <View style={styles.viewWork}>
          <Text variant="caption" color="brand">
            View work
          </Text>
          <ChevronRightIcon size={14} color={colors.brand} />
        </View>
      </Pressable>
      {working ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop this turn"
          onPress={onStop}
          style={styles.stop}
          testID="work-rail-stop"
        >
          <StopIcon size={18} color={colors.error} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ToolRailRow({ row }: { row: ToolRow }) {
  const { colors, reduceMotion } = useTheme();
  const reveal = useRef(new Animated.Value(row.historical || reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (row.historical || reduceMotion) {
      reveal.setValue(1);
      return;
    }
    Animated.timing(reveal, {
      toValue: 1,
      duration: motion.toolReveal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, reveal, row.historical]);
  const failed = row.state === 'failed';
  const running = row.state === 'running';
  return (
    <Animated.View
      style={[
        styles.row,
        {
          opacity: reveal,
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
          ],
        },
      ]}
      testID={`work-row-${row.callId}`}
    >
      {failed ? (
        <StopIcon size={14} color={colors.error} />
      ) : running ? (
        <WorkIcon size={16} color={colors.success} />
      ) : (
        <CheckIcon size={16} color={colors.muted} />
      )}
      <Text variant="small" numberOfLines={1} style={{ marginLeft: space.xs, flexShrink: 0 }}>
        {operation(row.name)}
      </Text>
      <Text variant="caption" color={failed ? 'error' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
        {targetLabel(row)}
      </Text>
      <Text variant="caption" color={failed ? 'error' : running ? 'success' : 'muted'}>
        {stateLabel(row)}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingLeft: space.lg,
    overflow: 'hidden',
  },
  rows: { flex: 1, paddingVertical: space.xxs },
  row: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  viewWork: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  stop: { width: target, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  sweepTrack: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
  sweep: { width: 120, height: 1 },
});
