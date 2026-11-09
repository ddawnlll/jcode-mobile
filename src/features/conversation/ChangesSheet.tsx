import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '../../design/BottomSheet';
import { Divider, TextAction } from '../../design/controls';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import type { ChangeRecord } from '../../core/state/store';

export function ChangesSheet({
  visible,
  onClose,
  changes,
}: {
  visible: boolean;
  onClose: () => void;
  changes: ChangeRecord[];
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Changes">
      <View style={{ paddingHorizontal: space.lg }} testID="changes-sheet">
        <View style={styles.header}>
          <View>
            <Text variant="title" accessibilityRole="header">
              Changes
            </Text>
            <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
              Confirmed tool-reported edits only
            </Text>
          </View>
          <TextAction label="Close" onPress={onClose} color="muted" />
        </View>
        <Divider />
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: space.xl }}>
          {changes.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="body" color="muted">
                No confirmed file changes in this session.
              </Text>
              <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
                Assistant prose is never reinterpreted as a diff.
              </Text>
            </View>
          ) : (
            changes.map((change) => {
              const expanded = open === change.key;
              return (
                <View key={change.key} style={[styles.row, { borderBottomColor: colors.line }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} change ${change.path}`}
                    onPress={() => setOpen(expanded ? null : change.key)}
                    style={styles.rowHeader}
                    testID={`change-${change.path}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="small" numberOfLines={2}>
                        {change.path}
                      </Text>
                      <Text variant="caption" color="muted">
                        {change.operation}
                        {change.evidence === 'diff'
                          ? ` · +${change.added ?? 0} −${change.removed ?? 0}`
                          : ' · path evidence'}
                      </Text>
                    </View>
                    <Text variant="caption" color="brand">
                      {expanded ? 'Hide' : 'View'}
                    </Text>
                  </Pressable>
                  {expanded && change.diff ? (
                    <View style={[styles.diff, { backgroundColor: colors.raised }]}>
                      {change.diff.split('\n').slice(0, 120).map((line, index) => {
                        const added = line.startsWith('+') && !line.startsWith('+++');
                        const removed = line.startsWith('-') && !line.startsWith('---');
                        return (
                          <Text
                            key={index}
                            variant="codeSmall"
                            selectable
                            style={{
                              color: added
                                ? colors.syntaxInserted
                                : removed
                                  ? colors.syntaxDeleted
                                  : colors.ink,
                            }}
                          >
                            {line || ' '}
                          </Text>
                        );
                      })}
                    </View>
                  ) : expanded ? (
                    <Text variant="caption" color="muted" style={{ paddingBottom: space.sm }}>
                      The tool result did not carry a structured diff. The path is shown as
                      evidence, not a reconstructed patch.
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  empty: { paddingVertical: space.xl },
  row: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowHeader: { minHeight: target, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  diff: { borderRadius: radius.control, padding: space.sm, marginBottom: space.sm },
});
