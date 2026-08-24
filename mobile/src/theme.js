import { MD3LightTheme } from 'react-native-paper';

// Design tokens globais do PriceScoutPT.
// Todas as cores, espaçamentos e raios devem vir daqui — sem hex mágicos espalhados.
export const colors = {
  primary: '#0050AA',
  primaryContainer: '#E3F2FD',
  secondary: '#003A70',
  success: '#1E7B34',
  successContainer: '#E2F0D9',
  danger: '#C62828',
  dangerContainer: '#FCE4D6',
  warning: '#8F4700',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceVariant: '#F5F5F5',
  border: '#EAEAEA',
  borderStrong: '#8F8F8F',
  textPrimary: '#111111',
  textSecondary: '#555555',
  textMuted: '#636363',
  gold: '#FFD700',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 12,
  xl: 16,
};

// Cores de marca dos supermercados (badges, chips de filtro, preços).
// Fonte única — ProductCard mapeia os ids da BD para estas cores.
export const supermarketBrands = {
  continente: '#C62828',
  lidl: '#0050AA',
  pingodoce: '#2B8C3D',
  aldi: '#003A70',
  auchan: '#E4002B',
};

// Converte '#RRGGBB' + alpha em 'rgba(r, g, b, alpha)' — para gráficos e
// overlays que precisam da cor primária com transparência.
export const rgba = (hex, alpha) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    secondaryContainer: colors.primaryContainer,
    background: colors.background,
    surface: colors.surface,
    error: colors.danger,
  },
  roundness: 3,
};
