// ============================================================
// PriceScoutPT — MD3 Design Tokens (fonte única de verdade).
// Nenhum outro ficheiro pode conter hex, durações ou easings crus.
// Paleta gerada a partir da seed #0050AA via @material/material-color-utilities
// (o mesmo motor do Material Theme Builder — m3.material.io/theme-builder).
// ============================================================

import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from '@material/material-color-utilities';

// ------------------------------------------------------------
// 4.1 Seed & paleta tonal MD3 (roles completos, light + dark)
// ------------------------------------------------------------
export const BRAND_SEED_COLOR = '#0050AA';

// Paleta dos supermercados (identidade funcional, não tema) — os UUIDs são as
// PKs da tabela `supermarkets` no WatermelonDB.
export const supermarketBrands = {
  '00000000-0000-0000-0000-000000000001': { name: 'Continente', color: '#C62828' },
  '00000000-0000-0000-0000-000000000002': { name: 'Lidl', color: '#0050AA' },
  '00000000-0000-0000-0000-000000000003': { name: 'Pingo Doce', color: '#2B8C3D' },
  '00000000-0000-0000-0000-000000000004': { name: 'Aldi', color: '#003A70' },
  '00000000-0000-0000-0000-000000000005': { name: 'Auchan', color: '#E4002B' },
};
export const DEFAULT_BRAND_COLOR = '#636363';

const _theme = themeFromSourceColor(argbFromHex(BRAND_SEED_COLOR));

const toHexScheme = (scheme) => {
  const roles = {};
  Object.entries(scheme).forEach(([role, value]) => {
    roles[role] = value ? hexFromArgb(value) : value;
  });
  return roles;
};

// MD3 roles (spec m3.material.io). Paper usa `elevation.level0..5`; os
// surfaceContainer* são a componente tonal da elevação.
export const lightColors = {
  ...toHexScheme(_theme.schemes.light),
  elevation: {
    level0: toHexScheme(_theme.schemes.light).surfaceContainerLowest,
    level1: toHexScheme(_theme.schemes.light).surfaceContainerLow,
    level2: toHexScheme(_theme.schemes.light).surfaceContainer,
    level3: toHexScheme(_theme.schemes.light).surfaceContainerHigh,
    level4: toHexScheme(_theme.schemes.light).surfaceContainerHigh,
    level5: toHexScheme(_theme.schemes.light).surfaceContainerHighest,
  },
};

export const darkColors = {
  ...toHexScheme(_theme.schemes.dark),
  elevation: {
    level0: toHexScheme(_theme.schemes.dark).surfaceContainerLowest,
    level1: toHexScheme(_theme.schemes.dark).surfaceContainerLow,
    level2: toHexScheme(_theme.schemes.dark).surfaceContainer,
    level3: toHexScheme(_theme.schemes.dark).surfaceContainerHigh,
    level4: toHexScheme(_theme.schemes.dark).surfaceContainerHigh,
    level5: toHexScheme(_theme.schemes.dark).surfaceContainerHighest,
  },
};

// ------------------------------------------------------------
// 4.2 Tipografia (MD3 type roles)
// ------------------------------------------------------------
const font = (fontSize, lineHeight, fontWeight, letterSpacing) => ({
  fontFamily: 'sans-serif',
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
});

export const typography = {
  displayLarge: font(57, 64, '400', -0.25),
  displayMedium: font(45, 52, '400', 0),
  displaySmall: font(36, 44, '400', 0),
  headlineLarge: font(32, 40, '400', 0),
  headlineMedium: font(28, 36, '400', 0),
  headlineSmall: font(24, 32, '400', 0),
  titleLarge: font(22, 28, '400', 0),
  titleMedium: font(16, 24, '500', 0.15),
  titleSmall: font(14, 20, '500', 0.1),
  bodyLarge: font(16, 24, '400', 0.5),
  bodyMedium: font(14, 20, '400', 0.25),
  bodySmall: font(12, 16, '400', 0.4),
  labelLarge: font(14, 20, '500', 0.1),
  labelMedium: font(12, 16, '500', 0.5),
  labelSmall: font(11, 16, '500', 0.5),
};

// ------------------------------------------------------------
// 4.3 Shape (dp)
// ------------------------------------------------------------
export const shape = {
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
};

// ------------------------------------------------------------
// Espaçamento (manter a grelha existente da app)
// ------------------------------------------------------------
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// ------------------------------------------------------------
// 4.5 Motion — valores oficiais MD3 (não inventar)
// ------------------------------------------------------------
export const easing = {
  emphasized: { x1: 0.2, y1: 0.0, x2: 0, y2: 1.0 },
  emphasizedDecelerate: { x1: 0.05, y1: 0.7, x2: 0.1, y2: 1.0 },
  emphasizedAccelerate: { x1: 0.3, y1: 0.0, x2: 0.8, y2: 0.15 },
  standard: { x1: 0.2, y1: 0.0, x2: 0, y2: 1.0 },
  standardDecelerate: { x1: 0.0, y1: 0.0, x2: 0.0, y2: 1.0 },
  standardAccelerate: { x1: 0.3, y1: 0.0, x2: 1.0, y2: 1.0 },
};

export const duration = {
  short1: 50,
  short2: 100,
  short3: 150,
  short4: 200,
  medium1: 250,
  medium2: 300,
  medium3: 350,
  medium4: 400,
  long1: 450,
  long2: 500,
  long3: 550,
  long4: 600,
  extraLong1: 700,
  extraLong2: 800,
  extraLong3: 900,
  extraLong4: 1000,
};

// M3 Expressive springs: damping = dampingRatio * 2 * sqrt(stiffness * mass)
export const spring = {
  spatialDefault: { dampingRatio: 0.6, stiffness: 700, mass: 1 },
  spatialFast: { dampingRatio: 0.6, stiffness: 1400, mass: 1 },
  spatialSlow: { dampingRatio: 0.6, stiffness: 350, mass: 1 },
  effectDefault: { dampingRatio: 1.0, stiffness: 1600, mass: 1 },
  effectFast: { dampingRatio: 1.0, stiffness: 3800, mass: 1 },
  effectSlow: { dampingRatio: 1.0, stiffness: 800, mass: 1 },
  spatialStandard: { dampingRatio: 0.9, stiffness: 700, mass: 1 },
};

// Conversão para a API do Reanimated (withSpring)
export const toReanimatedSpring = (preset) => {
  const { dampingRatio, stiffness, mass } = preset;
  return {
    damping: dampingRatio * 2 * Math.sqrt(stiffness * mass),
    stiffness,
    mass,
  };
};

// ------------------------------------------------------------
// 4.6 Loading (shimmer / wavy / M3 LoadingIndicator)
// ------------------------------------------------------------
export const loading = {
  shimmer: {
    baseRole: 'surfaceVariant',
    highlightRole: 'surfaceContainerHighest',
    durationMs: 1200,
  },
  wavy: {
    trackRole: 'surfaceContainerHighest',
    waveRole: 'primary',
    height: 4,
    cycleMs: 1500,
  },
  loadingIndicator: {
    size: 48,
    minSize: 24,
    maxSize: 240,
    cycleMs: 1400,
  },
  skeletonRevealMs: 300,
};
