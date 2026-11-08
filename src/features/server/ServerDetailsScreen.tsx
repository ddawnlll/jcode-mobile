import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, TextAction } from '../../design/controls';
import { BackIcon, LinkIcon, LinkOffIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { geometry, radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { formatClock } from '../../core/session/selectors';
import { useAppStore } from '../../core/state/store';
import { cacheStats } from '../../core/persistence/db';

export function ServerDetailsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const connection = useAppStore((state) => state.connection);
  const appearance = useAppStore((state) => state.appearance);
  const privacyPreview = useAppStore((state) => state.privacyPreview);
  const deviceName = useAppStore((state) => state.deviceName);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof controller.serverDetails>>>(null);
  const [cache, setCache] = useState<{ bytes: number; sessions: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Array<{ id: string; label: string; host: string; active: boolean }>>([]);

  const refresh = useCallback(async () => {
    const [next, stats, servers] = await Promise.all([
      controller.serverDetails(),
      cacheStats(),
      controller.profiles(),
    ]);
    setDetails(next);
    setCache(stats);
    setProfiles(servers);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    void refresh();
  }, [connection.state, connection.daemonVersion, refresh]);

  const continuation = connection.capabilities.includes('mobile_continuation');

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.appBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={styles.iconTarget}
        >
          <BackIcon size={22} color={colors.ink} />
        </Pressable>
        <Text variant="body" weight="semibold">
          Server details
        </Text>
        <View style={styles.iconTarget} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
        <View style={styles.header}>
          <Text variant="screen" accessibilityRole="header">
            {details?.label ?? connection.serverLabel ?? 'Server'}
          </Text>
          <Text variant="code" color="muted" style={{ marginTop: space.xxs }}>
            {details?.host ?? connection.host}
          </Text>
          <View style={styles.stateRow}>
            {connection.state === 'current' ? (
              <LinkIcon size={18} color={colors.success} />
            ) : (
              <LinkOffIcon size={18} color={colors.muted} />
            )}
            <Text variant="small" color={connection.state === 'current' ? 'ink' : 'muted'}>
              {connection.state === 'current'
                ? 'Current'
                : connection.state === 'connecting'
                  ? 'Connecting…'
                  : connection.state === 'reconnecting'
                    ? `Reconnecting. Last checked at ${formatClock(connection.lastCheckedAt) || '—'}.`
                    : connection.state === 'offline'
                      ? `Offline. Last checked at ${formatClock(connection.lastCheckedAt) || '—'}.`
                      : connection.state === 'pair_again'
                        ? 'This phone is no longer authorized.'
                        : connection.state === 'incompatible'
                          ? 'This server needs mobile continuation support.'
                          : 'Saved on this phone.'}
            </Text>
          </View>
        </View>

        {profiles.length > 1 ? (
          <Group title="Servers">
            {profiles.map((profile) => (
              <Pressable
                key={profile.id}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${profile.label}`}
                accessibilityState={{ selected: profile.active }}
                disabled={profile.active}
                onPress={async () => {
                  await controller.switchProfile(profile.id);
                  navigation.navigate('Sessions' as never);
                }}
                style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="body">{profile.label}</Text>
                  <Text variant="caption" color="muted">
                    {profile.host}
                  </Text>
                </View>
                <Text variant="small" color={profile.active ? 'success' : 'muted'}>
                  {profile.active ? 'Current' : 'Switch'}
                </Text>
              </Pressable>
            ))}
          </Group>
        ) : null}

        <Group title="Connection">
          <SettingRow label="JCode version" value={connection.daemonVersion ?? 'Not reported yet'} />
          <SettingRow
            label="Last contact"
            value={connection.lastCheckedAt ? formatClock(connection.lastCheckedAt) : 'Not yet'}
          />
          <SettingRow
            label="Mobile continuation"
            value={continuation ? 'Ready' : 'Needs support'}
            valueColor={continuation ? 'success' : 'warning'}
          />
          <SettingRow label="Transport" value={details?.tls ? 'TLS (wss)' : 'Local development (ws)'} />
          {details?.capabilities.length ? (
            <SettingRow label="Capabilities" value={`${details.capabilities.length} negotiated`} />
          ) : null}
        </Group>

        <Group title="This phone">
          <SettingRow label="Device" value={deviceName || 'JCode Mobile'} />
          <SettingRow label="Notifications" value="Not available on this server" />
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Hide content in the app switcher"
            accessibilityState={{ checked: privacyPreview }}
            onPress={() => void controller.setPrivacyPreview(!privacyPreview)}
            style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="body">App switcher preview</Text>
              <Text variant="caption" color="muted">
                {privacyPreview ? 'Hidden when the app is not active' : 'Visible'}
              </Text>
            </View>
            <View
              style={[
                styles.switch,
                { backgroundColor: privacyPreview ? colors.brand : colors.raised, borderColor: colors.control },
              ]}
            >
              <View
                style={[
                  styles.knob,
                  {
                    backgroundColor: privacyPreview ? colors.onBrand : colors.muted,
                    alignSelf: privacyPreview ? 'flex-end' : 'flex-start',
                  },
                ]}
              />
            </View>
          </Pressable>
        </Group>

        <Group title="Appearance">
          <View style={styles.segments}>
            {(['system', 'light', 'night'] as const).map((value) => {
              const active = appearance === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={value === 'night' ? 'Night' : value === 'light' ? 'Light' : 'System'}
                  onPress={() => void controller.setAppearance(value)}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: active ? colors.brand : colors.raised,
                      borderColor: active ? colors.brand : colors.control,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text variant="button" style={{ color: active ? colors.onBrand : colors.ink }}>
                    {value === 'night' ? 'Night' : value === 'light' ? 'Light' : 'System'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Group>

        <Group title="Local data">
          <SettingRow
            label="Saved transcripts"
            value={cache ? `${(cache.bytes / (1024 * 1024)).toFixed(1)} MiB · ${cache.sessions} sessions` : '—'}
          />
          <TextAction
            label={busy === 'cache' ? 'Clearing…' : 'Clear local transcript cache'}
            onPress={async () => {
              setBusy('cache');
              await controller.clearLocalCache();
              await refresh();
              setBusy(null);
            }}
            disabled={busy === 'cache'}
          />
          <Text variant="caption" color="muted">
            Drafts, reading positions, and unconfirmed sends are kept.
          </Text>
        </Group>

        <View style={styles.actions}>
          <Button
            label="Disconnect this phone"
            variant="secondary"
            fullWidth
            onPress={async () => {
              await controller.disconnect();
              navigation.goBack();
            }}
          />
          <Text variant="caption" color="muted">
            Disconnecting closes the transport and keeps this profile and its cache. It does not stop
            work on your server.
          </Text>
          <TextAction
            label="Connect another server"
            onPress={() => navigation.navigate('Connect' as never)}
          />
          <TextAction
            label="Pair this phone again"
            onPress={() => navigation.navigate('Connect' as never)}
          />
          <TextAction
            label="Forget this server"
            color="error"
            onPress={() => {
              Alert.alert(
                'Forget this server?',
                'This removes the device token, drafts, reading positions, and cached transcripts for this server from this phone. It does not revoke the token on the server.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Forget server',
                    style: 'destructive',
                    onPress: async () => {
                      await controller.forgetServer();
                      navigation.navigate('Sessions' as never);
                    },
                  },
                ],
              );
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="small" color="muted" style={styles.groupTitle}>
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

function SettingRow({
  label,
  value,
  valueColor = 'ink',
}: {
  label: string;
  value: string;
  valueColor?: 'ink' | 'muted' | 'success' | 'warning' | 'error';
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.line }]}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="small" color={valueColor} style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  iconTarget: { width: target, height: target, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: geometry.gutterCompact, paddingTop: space.md, paddingBottom: space.lg },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, marginTop: space.sm },
  group: { paddingHorizontal: geometry.gutterCompact, paddingTop: space.lg },
  groupTitle: { marginBottom: space.xs },
  settingRow: {
    minHeight: geometry.settingsRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  toggleRow: {
    minHeight: geometry.settingsRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  switch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    padding: 3,
    justifyContent: 'center',
  },
  knob: { width: 20, height: 20, borderRadius: 10 },
  segments: { flexDirection: 'row', gap: space.xs, marginTop: space.xs },
  segment: {
    flex: 1,
    minHeight: target,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { paddingHorizontal: geometry.gutterCompact, marginTop: space.xxl, gap: space.sm },
});
