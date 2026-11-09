/**
 * Theme family registry.
 *
 * Source: docs/v0.2.0/themes.json at 778b6d9 (Tidal Glass handoff), copied
 * verbatim to themes.json. Tidal Light/Night are the original 0.1.x colors.
 * Every family supplies both modes; app-authored light companions are marked
 * in `adaptation` in the source data.
 */
import data from './themes.json';

export type ColorScheme = 'light' | 'night';
export type AppearancePreference = 'system' | 'light' | 'night';
export type EffectsPreference = 'auto' | 'reduced';
export type ReasoningDisplay = 'hidden' | 'compact' | 'expanded';

export interface ThemePalette {
  bg: string;
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  line: string;
  control: string;
  brand: string;
  onBrand: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  warning: string;
  error: string;
  focus: string;
  glassText: string;
  glassTextPlate: string;
  glassTint: string;
  glassTintAlpha: number;
  glassFallback: string;
  glassEdge: string;
  prioritySurface: string;
  priorityInk: string;
  syntaxKeyword: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxComment: string;
  syntaxPunctuation: string;
  syntaxInserted: string;
  syntaxDeleted: string;
}

export interface ThemeFamily {
  id: string;
  name: string;
  subtitle: string;
  default?: boolean;
  source: string;
  adaptation: string;
  modes: Record<ColorScheme, ThemePalette>;
}

interface ThemeDocument {
  schemaVersion: string;
  direction: string;
  defaultFamily: string;
  defaultAppearance: AppearancePreference;
  families: ThemeFamily[];
  selection: {
    themeFamily: string;
    appearance: string;
    reasoningDisplay: string;
    reasoningDefault: ReasoningDisplay;
  };
  materials: {
    blurRadiusCssPx: number;
    maxVisibleBlurRegions: number;
    reduceTransparency: string;
    effects: string;
  };
  motion: Record<string, number | number[] | Record<string, number>>;
}

const document = data as unknown as ThemeDocument;

export const themeFamilies: ThemeFamily[] = document.families;
export const DEFAULT_THEME_FAMILY = document.defaultFamily;
export const DEFAULT_APPEARANCE: AppearancePreference = document.defaultAppearance;
export const DEFAULT_REASONING_DISPLAY: ReasoningDisplay =
  document.selection.reasoningDefault ?? 'compact';
export const material = document.materials;

export function isThemeFamily(value: string | null | undefined): value is string {
  return !!value && document.families.some((family) => family.id === value);
}

export function themeFamily(id: string | null | undefined): ThemeFamily {
  return (
    document.families.find((family) => family.id === id) ??
    document.families.find((family) => family.default) ??
    document.families[0]
  );
}

export function resolveScheme(
  preference: AppearancePreference,
  systemScheme: ColorScheme | null | undefined,
): ColorScheme {
  if (preference === 'light' || preference === 'night') return preference;
  return systemScheme === 'night' ? 'night' : 'light';
}

export function paletteFor(
  familyId: string | null | undefined,
  scheme: ColorScheme,
): ThemePalette {
  return themeFamily(familyId).modes[scheme];
}

/** All 22 palettes, used by appearance previews and contrast tests. */
export const allPalettes: Array<{
  family: ThemeFamily;
  scheme: ColorScheme;
  palette: ThemePalette;
}> = themeFamilies.flatMap((family) =>
  (['light', 'night'] as const).map((scheme) => ({
    family,
    scheme,
    palette: family.modes[scheme],
  })),
);

export function isAppearance(value: string | null | undefined): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'night';
}

export function isEffects(value: string | null | undefined): value is EffectsPreference {
  return value === 'auto' || value === 'reduced';
}

export function isReasoningDisplay(value: string | null | undefined): value is ReasoningDisplay {
  return value === 'hidden' || value === 'compact' || value === 'expanded';
}
