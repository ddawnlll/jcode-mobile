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

export type AppearancePreference = 'system' | 'light' | 'night';
export type ColorScheme = 'light' | 'night';

export const fonts = {
  display: 'BricolageGrotesque-SemiBold',
  body: 'HankenGrotesk-Regular',
  bodyMedium: 'HankenGrotesk-Medium',
  bodySemibold: 'HankenGrotesk-SemiBold',
  mono: 'IBMPlexMono-Regular',
} as const;

export type FontFamily = (typeof fonts)[keyof typeof fonts];

export interface Palette {
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
}

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    bg: '#F3F6F5',
    surface: '#FFFFFF',
    raised: '#E8EFEC',
    ink: '#173B3A',
    muted: '#536B65',
    line: '#D5E0DB',
    control: '#718981',
    brand: '#164F49',
    onBrand: '#F4F8F5',
    accent: '#E56F4D',
    accentSoft: '#FFE4D8',
    onAccent: '#542211',
    success: '#276554',
    warning: '#81502A',
    error: '#A23C2D',
    focus: '#316E68',
  },
  night: {
    bg: '#111F20',
    surface: '#192C2B',
    raised: '#223735',
    ink: '#E5F0EB',
    muted: '#A0B6AD',
    line: '#344D48',
    control: '#69867E',
    brand: '#B5D6C5',
    onBrand: '#18392E',
    accent: '#F2B09A',
    accentSoft: '#432E27',
    onAccent: '#F7C1AA',
    success: '#A8D6BF',
    warning: '#E7C39D',
    error: '#F0A698',
    focus: '#B5D6C5',
  },
};

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
  easeOut: [0.22, 1, 0.36, 1] as const,
  easeMove: [0.4, 0, 0.2, 1] as const,
  easeExit: [0.4, 0, 1, 1] as const,
  spring: { mass: 1, stiffness: 360, damping: 38, overshootClamping: true },
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
} as const;

export const reconnect = {
  delaysMs: [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const,
  capMs: 30_000,
  jitter: 0.2,
} as const;
