import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { BottomSheet } from '../../design/BottomSheet';
import { Divider, TextAction } from '../../design/controls';
import { useTheme } from '../../design/theme';
import { radius, space } from '../../design/tokens';
import { Text } from '../../design/typography';
import { formatClock } from '../../core/session/selectors';
import type { ContextSnapshot } from '../../core/state/store';

export function ContextSheet({
  visible,
  onClose,
  snapshot,
  model,
  onNewSession,
}: {
  visible: boolean;
  onClose: () => void;
  snapshot: ContextSnapshot | null;
  model: string | null;
  onNewSession: () => void;
}) {
  const { colors } = useTheme();
  const used = snapshot?.usedTokens ?? null;
  const limit = snapshot?.limitTokens ?? null;
  const known = used !== null && limit !== null && limit > 0;
  const ratio = known ? Math.min(1, used / limit) : 0;
  const remaining = known ? Math.max(0, limit - used) : null;
  const percent = known ? Math.round((used / limit) * 100) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Context window">
      <View style={{ paddingHorizontal: space.lg }} testID="context-sheet">
        <View style={styles.header}>
          <View>
            <Text variant="title" accessibilityRole="header">
              Context
            </Text>
            <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
              {snapshot ? basisLabel(snapshot.basis) : 'Context unavailable'}
            </Text>
          </View>
          <Ring ratio={known ? ratio : null} percent={percent} />
        </View>
        <View style={[styles.counts, { backgroundColor: colors.raised }]}>
          <Count label="Used" value={used !== null ? formatNumber(used) : 'Unavailable'} />
          <Count label="Limit" value={limit !== null ? formatNumber(limit) : 'Unavailable'} />
          <Count label="Remaining" value={remaining !== null ? formatNumber(remaining) : 'Unavailable'} />
        </View>
        {known && percent !== null && percent >= 70 ? (
          <Text variant="small" color={percent >= 90 ? 'error' : 'warning'} style={{ marginTop: space.sm }}>
            {percent >= 90 ? 'Context is nearly full' : 'Context is filling up'}
          </Text>
        ) : null}
        {snapshot && snapshot.freshness === 'stale' ? (
          <Text variant="small" color="warning" style={{ marginTop: space.sm }}>
            Last-known snapshot. Waiting for the server to reconcile.
          </Text>
        ) : null}
        <Divider />
        <View style={styles.meta}>
          <Meta label="Model" value={snapshot?.model ?? model ?? 'Unavailable'} />
          <Meta
            label="Observed"
            value={snapshot ? formatClock(snapshot.observedAt) || 'Unknown' : 'Unknown'}
          />
          <Meta label="Source" value={snapshot?.source === 'cached' ? 'Saved on this phone' : 'Server'} />
          <Meta label="Basis" value={snapshot ? basisLabel(snapshot.basis) : 'Unknown'} />
        </View>
        {!known ? (
          <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
            The server has not reported both current prompt occupancy and a model limit. No
            percentage is estimated from history length or billing totals.
          </Text>
        ) : null}
        <TextAction label="New session in this project" onPress={onNewSession} />
        <TextAction label="Close" onPress={onClose} align="center" color="muted" />
        <View style={{ height: space.lg }} />
      </View>
    </BottomSheet>
  );
}

function Ring({ ratio, percent }: { ratio: number | null; percent: number | null }) {
  const { colors } = useTheme();
  const size = 72;
  const stroke = 6;
  const radiusValue = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusValue;
  return (
    <View
      accessibilityRole={ratio !== null ? 'progressbar' : undefined}
      accessibilityLabel={percent !== null ? `Context ${percent} percent` : 'Context usage unavailable'}
      accessibilityValue={percent !== null ? { min: 0, max: 100, now: percent } : undefined}
      style={styles.ring}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radiusValue} stroke={colors.line} strokeWidth={stroke} fill="none" />
        {ratio !== null ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radiusValue}
            stroke={ratio >= 0.9 ? colors.error : colors.brand}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={circumference * (1 - ratio)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <Text variant="caption" weight="semibold" style={styles.ringLabel}>
        {percent !== null ? `${percent}%` : '—'}
      </Text>
    </View>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.count}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="body" weight="semibold" tabular>
        {value}
      </Text>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text variant="small" color="muted">
        {label}
      </Text>
      <Text variant="small" numberOfLines={2} style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function basisLabel(basis: ContextSnapshot['basis']): string {
  return basis === 'current_prompt'
    ? 'Current prompt context'
    : basis === 'last_request'
      ? 'Last request context'
      : 'Usage basis unknown';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ring: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { position: 'absolute' },
  counts: { flexDirection: 'row', borderRadius: radius.control, padding: space.sm, marginTop: space.md },
  count: { flex: 1, gap: 2 },
  meta: { gap: space.xs, paddingVertical: space.md },
  metaRow: { flexDirection: 'row', gap: space.sm, minHeight: 28, alignItems: 'center' },
});
