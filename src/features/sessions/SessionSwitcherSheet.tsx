import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '../../design/BottomSheet';
import { Divider } from '../../design/controls';
import { CheckIcon, ChevronRightIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { geometry, radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { basename, formatTime } from '../../core/session/selectors';
import { useAppStore } from '../../core/state/store';
import type { SessionInfo } from '../../core/protocol/frames';

export function SessionSwitcherSheet({
  visible,
  onClose,
  onSelect,
  onAllSessions,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (session: SessionInfo) => void;
  onAllSessions: () => void;
}) {
  const { colors } = useTheme();
  const sessions = useAppStore((state) => state.inventory.sessions);
  const currentId = useAppStore((state) => state.conversation.sessionId);
  const recent = useMemo(() => sessions.slice(0, 12), [sessions]);

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Switch session">
      <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header">
            Switch session
          </Text>
          <Text variant="caption" color="muted">
            Recent
          </Text>
        </View>
        <ScrollView>
          {recent.map((session, index) => {
            const active = session.session_id === currentId;
            return (
              <View key={session.session_id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${session.title ?? 'Untitled session'}${active ? ', current' : ''}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(session)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? colors.raised : 'transparent' },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="body" weight={active ? 'semibold' : 'regular'} numberOfLines={1}>
                      {session.title?.trim() || 'Untitled session'}
                    </Text>
                    <Text variant="caption" color="muted" numberOfLines={1}>
                      {basename(session.working_dir) || 'No folder'}
                      {session.live_state === 'working' ? ' · Working' : ''}
                    </Text>
                  </View>
                  {active ? (
                    <CheckIcon size={18} color={colors.brand} />
                  ) : (
                    <>
                      <Text variant="caption" color="muted" tabular>
                        {formatTime(session.updated_at_ms)}
                      </Text>
                      <ChevronRightIcon size={16} color={colors.muted} />
                    </>
                  )}
                </Pressable>
                {index < recent.length - 1 ? <Divider inset={geometry.gutterCompact} /> : null}
              </View>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="All sessions"
            onPress={onAllSessions}
            style={({ pressed }) => [
              styles.allRow,
              { backgroundColor: pressed ? colors.raised : colors.surface },
            ]}
          >
            <Text variant="button" color="brand">
              All sessions
            </Text>
            <ChevronRightIcon size={18} color={colors.brand} />
          </Pressable>
          <View style={{ height: space.lg }} />
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: geometry.gutterCompact,
    paddingBottom: space.sm,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: geometry.gutterCompact,
    gap: space.sm,
  },
  allRow: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: geometry.gutterCompact,
    marginTop: space.xs,
    borderRadius: radius.control,
    marginHorizontal: space.sm,
  },
});
