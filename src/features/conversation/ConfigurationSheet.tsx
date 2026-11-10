import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet } from '../../design/BottomSheet';
import { Button, Divider, TextAction } from '../../design/controls';
import { CheckIcon, SearchIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore } from '../../core/state/store';

export function ConfigurationSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const config = useAppStore((state) => state.conversation.config);
  const capabilities = useAppStore((state) => state.conversation.capabilities);
  const working = useAppStore((state) => state.conversation.execution.kind === 'working');
  const supported = capabilities.includes('session_config');
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<string>('all');
  const [model, setModel] = useState<string | null>(config.model);
  const [effort, setEffort] = useState<string | null>(config.effort);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setModel(config.model);
    setEffort(config.effort);
    setError(null);
    setLoading(true);
    void controller
      .refreshModels()
      .then((result) => setModels(result.models))
      .finally(() => setLoading(false));
  }, [visible, config.model, config.effort]);

  const providers = useMemo(() => {
    const names = [...new Set(config.routes.map((route) => route.provider))];
    return names.sort((a, b) => a.localeCompare(b));
  }, [config.routes]);

  const providerFor = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const route of config.routes) {
      map.set(route.model, [...(map.get(route.model) ?? []), route.provider]);
    }
    return map;
  }, [config.routes]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((entry) => {
      if (needle && !entry.toLowerCase().includes(needle)) return false;
      if (provider === 'all') return true;
      const routes = config.routes.filter((route) => route.model === entry);
      return routes.length === 0 || routes.some((route) => route.provider === provider);
    });
  }, [config.routes, models, provider, query]);

  const effortOptions = useMemo(() => {
    if (model && config.effortsByModel[model]?.length) return config.effortsByModel[model];
    return config.efforts;
  }, [config.efforts, config.effortsByModel, model]);

  const apply = async () => {
    setError(null);
    const result = await controller.configureSession({
      model: model === config.model ? undefined : model,
      effort: effort === config.effort ? undefined : effort,
    });
    if (!result.ok) setError(result.error ?? 'Configuration was not confirmed.');
    else onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Model and effort">
      <View style={{ paddingHorizontal: space.lg }} testID="configuration-sheet">
        <View style={styles.header}>
          <View>
            <Text variant="title" accessibilityRole="header">
              Model & effort
            </Text>
            <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
              Server-confirmed: {(config.modelConfirmed ? config.model : null) ?? 'Unavailable'}
              {config.effortConfirmed && config.effort ? ` · ${config.effort}` : ''}
            </Text>
          </View>
          <TextAction label="Cancel" onPress={onClose} color="muted" />
        </View>
        {working ? (
          <Text variant="small" color="warning" style={{ marginTop: space.xs }}>
            This turn is running. Configuration is not changed mid-turn.
          </Text>
        ) : null}
        {!supported ? (
          <Text variant="small" color="warning" style={{ marginTop: space.xs }}>
            This server adapter does not advertise session configuration. Update the adapter on
            the server to 0.2.2 or later; the app will not pretend a change was applied.
          </Text>
        ) : null}
        {providers.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.providerRow}
          >
            {['all', ...providers].map((name) => {
              const selected = provider === name;
              return (
                <Pressable
                  key={name}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  aria-checked={selected}
                  accessibilityLabel={`Provider ${name === 'all' ? 'All' : name}`}
                  onPress={() => setProvider(name)}
                  style={[
                    styles.provider,
                    {
                      borderColor: selected ? colors.brand : colors.line,
                      backgroundColor: selected ? colors.raised : colors.surface,
                    },
                  ]}
                  testID={`provider-${name}`}
                >
                  <Text variant="caption">{name === 'all' ? 'All' : name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <View style={[styles.search, { borderColor: colors.control, backgroundColor: colors.surface }]}>
          <SearchIcon size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search models"
            value={query}
            onChangeText={setQuery}
            placeholder="Search available models"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.ink }]}
          />
        </View>
        <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
          {loading ? (
            <Text variant="small" color="muted" style={{ paddingVertical: space.md }}>
              Reading the model catalog…
            </Text>
          ) : filtered.length === 0 ? (
            <Text variant="small" color="muted" style={{ paddingVertical: space.md }}>
              {models.length === 0
                ? 'No models reported by this server yet. Reconnect or retry.'
                : 'No model matches this search and provider.'}
            </Text>
          ) : (
            filtered.map((entry) => {
              const selected = entry === model;
              return (
                <Pressable
                  key={entry}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  aria-checked={selected}
                  accessibilityLabel={`Model ${entry}`}
                  onPress={() => {
                    setModel(entry);
                    setEffort(null);
                  }}
                  style={[styles.row, { borderColor: colors.line }]}
                  testID={`model-${entry}`}
                >
                  <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
                    {entry}
                  </Text>
                  {providerFor.get(entry)?.length ? (
                    <Text variant="caption" color="muted" numberOfLines={1}>
                      {providerFor.get(entry)!.join(', ')}
                    </Text>
                  ) : null}
                  {selected ? <CheckIcon size={18} color={colors.brand} /> : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <Divider />
        <Text variant="small" color="muted" style={{ marginTop: space.md }}>
          Effort for this model
        </Text>
        {effortOptions.length === 0 ? (
          <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
            Effort options unavailable for this route.
          </Text>
        ) : (
          <View style={styles.effortRow}>
            {effortOptions.map((entry) => (
              <Pressable
                key={entry}
                accessibilityRole="radio"
                accessibilityState={{ selected: effort === entry, checked: effort === entry }}
                aria-checked={effort === entry}
                accessibilityLabel={`Effort ${entry}`}
                onPress={() => setEffort(entry)}
                style={[
                  styles.effort,
                  {
                    borderColor: effort === entry ? colors.brand : colors.line,
                    backgroundColor: effort === entry ? colors.raised : colors.surface,
                  },
                ]}
                testID={`effort-${entry}`}
              >
                <Text variant="small">{entry}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Button
          label={config.applying ? 'Applying…' : 'Apply'}
          fullWidth
          loading={config.applying}
          disabled={!supported || working}
          onPress={() => void apply()}
          style={{ marginTop: space.md }}
          testID="configuration-apply"
        />
        {error || config.error ? (
          <Text variant="small" color="error" style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {error ?? config.error}
          </Text>
        ) : null}
        {!config.modelConfirmed ? (
          <Text variant="small" color="muted" style={{ marginTop: space.xs }}>
            The server has not confirmed an effective model for this session.
          </Text>
        ) : null}
        <View style={{ height: space.lg }} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  search: {
    minHeight: target,
    borderWidth: 1,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    marginTop: space.md,
    gap: space.xs,
  },
  searchInput: { flex: 1, minHeight: target, fontSize: 16, fontFamily: 'HankenGrotesk-Regular' },
  row: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  effortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  providerRow: { flexDirection: 'row', gap: space.xxs, marginTop: space.sm },
  provider: {
    minHeight: 40,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  effort: {
    minHeight: target,
    minWidth: 72,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
