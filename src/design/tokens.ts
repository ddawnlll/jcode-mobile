/**
 * Locked semantic tokens for JCode Mobile.
 *
 * Source of truth: design/reference/JCode_Mobile_Design_Handoff/DESIGN.md and
 * tokens.json. sRGB hex values are the React Native projection; the OKLCH
 * authoring values are kept in the handoff and must not be re-derived here.
 *
 * Do not introduce colors, radii, spacing steps, or motion durations outside
 * this file.
 */

import {
  DEFAULT_APPEARANCE,
  DEFAULT_REASONING_DISPLAY,
  DEFAULT_THEME_FAMILY,
  paletteFor,
  type ColorScheme,
  type ThemePalette,
} from './themes';

export type {
  AppearancePreference,
  ColorScheme,
  EffectsPreference,
  ReasoningDisplay,
} from './themes';

export type Palette = ThemePalette;

export const fonts = {
  display: 'BricolageGrotesque-SemiBold',
  body: 'HankenGrotesk-Regular',
  bodyMedium: 'HankenGrotesk-Medium',
  bodySemibold: 'HankenGrotesk-SemiBold',
  mono: 'IBMPlexMono-Regular',
} as const;

export type FontFamily = (typeof fonts)[keyof typeof fonts];

/** Tidal is the default family; screen files never define their own palette. */
export const palettes: Record<ColorScheme, Palette> = {
  light: paletteFor(DEFAULT_THEME_FAMILY, 'light'),
  night: paletteFor(DEFAULT_THEME_FAMILY, 'night'),
};

export const defaultThemeFamily = DEFAULT_THEME_FAMILY;
export const defaultAppearance = DEFAULT_APPEARANCE;
export const defaultReasoningDisplay = DEFAULT_REASONING_DISPLAY;

/** Allowed spacing scale. 4-unit base. */
export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  massive: 64,
} as const;

export const radius = {
  control: 12,
  sheet: 24,
} as const;

/** Hit-target floor for every action on both platforms. */
export const target = 48;

export const geometry = {
  appBar: 56,
  sessionRowMin: 88,
  composerMin: 56,
  composerMax: 144,
  workDock: 48,
  sheetInitialFraction: 0.64,
  gutterCompact: 20,
  gutterRegular: 24,
  searchMin: 48,
  toolRowMin: 64,
  planItemMin: 64,
  settingsRowMin: 56,
  codeInset: 12,
} as const;

export type TypeToken =
  | 'caption'
  | 'small'
  | 'body'
  | 'lead'
  | 'subhead'
  | 'title'
  | 'screen'
  | 'display'
  | 'welcome'
  | 'button'
  | 'code'
  | 'codeSmall';

export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamily;
  letterSpacing?: number;
}

export const type: Record<TypeToken, TypeStyle> = {
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bodyMedium },
  small: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bodyMedium },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.body },
  lead: { fontSize: 18, lineHeight: 26, fontFamily: fonts.body },
  subhead: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bodySemibold },
  title: { fontSize: 24, lineHeight: 30, fontFamily: fonts.bodySemibold },
  screen: {
    fontSize: 32,
    lineHeight: 36,
    fontFamily: fonts.display,
    letterSpacing: -0.64,
  },
  display: {
    fontSize: 40,
    lineHeight: 44,
    fontFamily: fonts.display,
    letterSpacing: -0.8,
  },
  welcome: {
    fontSize: 56,
    lineHeight: 60,
    fontFamily: fonts.display,
    letterSpacing: -1.4,
  },
  button: { fontSize: 16, lineHeight: 20, fontFamily: fonts.bodyMedium },
  code: { fontSize: 13, lineHeight: 20, fontFamily: fonts.mono },
  codeSmall: { fontSize: 12, lineHeight: 18, fontFamily: fonts.mono },
};

/** Motion tokens from DESIGN.md. Durations in ms. */
export const motion = {
  press: 80,
  feedback: 120,
  disclosure: 180,
  navigation: 240,
  sheet: 280,
  maxReturn: 320,
  /** Reduced Motion replaces travel with a brief crossfade. */
  reduced: 100,
  welcome: 600,
  loaderOrbit: 1_400,
  loaderRevealDelay: 180,
  loaderExit: 160,
  toolReveal: 180,
  easeOut: [0.22, 1, 0.36, 1] as const,
  easeMove: [0.4, 0, 0.2, 1] as const,
  easeExit: [0.4, 0, 1, 1] as const,
  spring: { mass: 1, stiffness: 360, damping: 38, overshootClamping: true },
} as const;

/**
 * Tidal Glass material. Live blur is bounded to two visible chrome regions;
 * every surface keeps an opaque fallback for Reduce Transparency, effects off,
 * web preview, or a platform where blur is unavailable.
 */
export const glass = {
  blurRadiusCss: 24,
  maxVisibleRegions: 2,
  edgeWidth: 1,
  light: { tintAlpha: 0.84 },
  night: { tintAlpha: 0.88 },
} as const;

/** Performance and cache budgets from PRODUCT_SPEC §14. */
export const budgets = {
  initialSessionSummaries: 50,
  initialHistoryMessages: 60,
  inventoryRefreshMs: 30_000,
  streamCoalesceMs: 100,
  streamMaxUpdatesPerSecond: 10,
  draftDebounceMs: 250,
  textCacheBytes: 32 * 1024 * 1024,
  imageCacheBytes: 32 * 1024 * 1024,
  toolPreviewLines: 24,
  toolPreviewBytes: 8 * 1024,
  codePreviewBytes: 64 * 1024,
  maxFrameBytes: 4 * 1024 * 1024,
  autofollowSlop: 80,
  /** Foreground liveness probe; never runs while the app is backgrounded. */
  healthCheckMs: 15_000,
  healthTimeoutMs: 5_000,
  /** Handshake + profile save + inventory + attach, not history. */
  connectAttemptMs: 45_000,
  /** A selected session must finish attach + history inside this window. */
  reconcileTimeoutMs: 25_000,
  /** Whole pairing request including body parsing. */
  pairRequestMs: 12_000,
  pairUiTimeoutMs: 20_000,
  renameTimeoutMs: 10_000,
} as const;

export const reconnect = {
  delaysMs: [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const,
  capMs: 30_000,
  jitter: 0.2,
} as const;
