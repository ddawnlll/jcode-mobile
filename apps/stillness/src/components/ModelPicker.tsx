/**
 * Model picker: instant search, provider chips, provider grouping, and routes
 * disambiguated by provider + API method + observed availability.
 */
import { useMemo, useState } from 'react';
import { controller, type AppState } from '../lib/controller';
import {
  filterModelRoutes,
  groupByProvider,
  isCurrentRoute,
  modelRoutePool,
  providerChips,
  routeKey,
} from '../lib/modelSearch';
import { IconCheck } from './Icons';
import { BottomSheet } from './BottomSheet';

export function ModelPicker({ state }: { state: AppState }) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const pool = useMemo(
    () => modelRoutePool(state.models?.models, state.runtime),
    [state.models?.models, state.runtime],
  );
  const chips = useMemo(() => providerChips(pool), [pool]);
  const filtered = useMemo(
    () => filterModelRoutes(pool, query, provider),
    [pool, provider, query],
  );
  const commandCode = filtered.filter((route) => route.is_command_code);
  const groups = useMemo(
    () => groupByProvider(filtered.filter((route) => !route.is_command_code)),
    [filtered],
  );

  const duplicateModels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of pool) counts.set(route.model, (counts.get(route.model) ?? 0) + 1);
    return counts;
  }, [pool]);

  const choose = async (model: string, providerName: string, key: string) => {
    setPending(key);
    await controller.selectModel(model, providerName);
    setPending(null);
  };

  const renderRoute = (route: (typeof pool)[number]) => {
    const key = routeKey(route);
    const selected = isCurrentRoute(route, state.runtime);
    const duplicate = (duplicateModels.get(route.model) ?? 0) > 1;
    return (
      <button
        key={key}
        className={`overlay-row model-route ${selected ? 'selected' : ''}`}
        disabled={!route.available || pending != null}
        onClick={() => void choose(route.model, route.provider, key)}
        aria-label={`Set model ${route.model} on ${route.provider} via ${route.api_method}`}
      >
        <span>
          <span className="model-name">
            {route.model}
            {selected ? <span className="model-current">Current</span> : null}
          </span>
          <small>
            {duplicate
              ? `${route.provider} · ${route.api_method} · ${route.available ? 'available' : 'unavailable'}`
              : `${route.provider} · ${route.api_method}`}
            {route.detail ? ` · ${route.detail}` : ''}
          </small>
        </span>
        {pending === key ? (
          <span className="model-pending">Setting…</span>
        ) : selected ? (
          <IconCheck size={18} />
        ) : !route.available ? (
          <span className="model-unavailable">Unavailable</span>
        ) : null}
      </button>
    );
  };

  return (
    <BottomSheet title="Model" onClose={() => controller.openSheet(null)} testId="model-sheet">
      {pool.length === 0 ? (
        <div className="honest-unavailable">
          <strong>No model routes are available.</strong>
          <p>The adapter has not received an authoritative runtime catalog for this session.</p>
          <button className="onboard-secondary" onClick={() => void controller.refreshModels()}>
            Retry runtime query
          </button>
        </div>
      ) : (
        <>
          <label className="picker-search">
            <span className="sr-only">Search models</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search model, provider, or API"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="filter-chips" role="group" aria-label="Filter by provider">
            <button
              type="button"
              className={`filter-chip ${provider === null ? 'is-on' : ''}`}
              aria-pressed={provider === null}
              onClick={() => setProvider(null)}
            >
              All <small>{pool.length}</small>
            </button>
            {chips.map((chip) => (
              <button
                key={chip.provider}
                type="button"
                className={`filter-chip ${provider === chip.provider ? 'is-on' : ''}`}
                aria-pressed={provider === chip.provider}
                onClick={() => setProvider(provider === chip.provider ? null : chip.provider)}
              >
                {chip.provider} <small>{chip.available}/{chip.count}</small>
              </button>
            ))}
          </div>
          {commandCode.length > 0 ? (
            <section className="model-section" data-testid="command-code-section">
              <h3>Command Code</h3>
              <p className="form-help">
                Native provider · account {state.runtime?.account_label ?? 'label unknown'}
              </p>
              {commandCode.map(renderRoute)}
            </section>
          ) : null}
          {groups.map((group) => (
            <section className="model-section" key={group.provider}>
              <h3>
                {group.provider} <small>{group.available} available</small>
              </h3>
              {group.routes.map(renderRoute)}
            </section>
          ))}
          {filtered.length === 0 ? (
            <p className="inspector-empty">No route matches that search on this provider.</p>
          ) : null}
          <p className="form-help">
            Availability is exactly what JCode reported. A model in the catalog is not proof of plan
            entitlement. The selected route is verified again from runtime state.
          </p>
        </>
      )}
    </BottomSheet>
  );
}
