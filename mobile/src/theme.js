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
  syncOverlay: '#E8F1FA',
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
