/**
 * Pure model-route search and grouping. Kept free of React so the picker
 * behaviour can be checked without a browser.
 */
import type { ModelRouteView, RuntimeView } from './protocol';

export function routeKey(route: Pick<ModelRouteView, 'provider' | 'model' | 'api_method'>): string {
  return `${route.provider}::${route.model}::${route.api_method}`;
}

export function modelRoutePool(
  models: ModelRouteView[] | null | undefined,
  runtime: RuntimeView | null | undefined,
): ModelRouteView[] {
  const source = models && models.length ? models : runtime?.routes ?? [];
  const seen = new Set<string>();
  const routes: ModelRouteView[] = [];
  for (const route of source) {
    if (!route || !route.model || !route.provider) continue;
    const key = routeKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(route);
  }
  return routes;
}

export function providerList(routes: ModelRouteView[]): string[] {
  return Array.from(new Set(routes.map((route) => route.provider))).sort((a, b) => a.localeCompare(b));
}

export function filterModelRoutes(
  routes: ModelRouteView[],
  query: string,
  provider: string | null,
): ModelRouteView[] {
  const needle = query.trim().toLowerCase();
  return routes.filter((route) => {
    if (provider && route.provider !== provider) return false;
    if (!needle) return true;
    return (
      route.model.toLowerCase().includes(needle) ||
      route.provider.toLowerCase().includes(needle) ||
      route.api_method.toLowerCase().includes(needle) ||
      route.detail.toLowerCase().includes(needle)
    );
  });
}

export interface ProviderGroup {
  provider: string;
  routes: ModelRouteView[];
  available: number;
}

export function groupByProvider(routes: ModelRouteView[]): ProviderGroup[] {
  const map = new Map<string, ProviderGroup>();
  for (const route of routes) {
    let group = map.get(route.provider);
    if (!group) {
      group = { provider: route.provider, routes: [], available: 0 };
      map.set(route.provider, group);
    }
    group.routes.push(route);
    if (route.available) group.available += 1;
  }
  return Array.from(map.values())
    .map((group) => ({
      ...group,
      routes: [...group.routes].sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return a.model.localeCompare(b.model);
      }),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

/** Duplicate model names are disambiguated by provider, API method, availability. */
export function disambiguation(route: ModelRouteView): string {
  return `${route.provider} · ${route.api_method} · ${route.available ? 'available' : 'unavailable'}`;
}

export function isCurrentRoute(
  route: ModelRouteView,
  runtime: RuntimeView | null | undefined,
): boolean {
  return Boolean(
    runtime &&
      runtime.model === route.model &&
      (!runtime.provider || runtime.provider === route.provider),
  );
}

/** Provider chips carry honest availability counts, never fake progress. */
export function providerChips(routes: ModelRouteView[]): Array<{ provider: string; count: number; available: number }> {
  return providerList(routes).map((provider) => {
    const owned = routes.filter((route) => route.provider === provider);
    return {
      provider,
      count: owned.length,
      available: owned.filter((route) => route.available).length,
    };
  });
}
