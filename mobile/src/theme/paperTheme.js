// Temas Paper (MD3) construídos a partir dos tokens — light + dark.
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { lightColors, darkColors, typography } from './tokens';

export const createPaperTheme = (isDark) => {
  const base = isDark ? MD3DarkTheme : MD3LightTheme;
  const colors = isDark ? darkColors : lightColors;
  return {
    ...base,
    colors: {
      ...base.colors,
      ...colors,
      // Papéis semânticos da app (alias MD3 — sem hex aqui)
      success: colors.tertiary,
      onSuccess: colors.onTertiary,
      successContainer: colors.tertiaryContainer,
      onSuccessContainer: colors.onTertiaryContainer,
      danger: colors.error,
      warning: colors.onErrorContainer,
      gold: colors.tertiary,
      textPrimary: colors.onSurface,
      textSecondary: colors.onSurfaceVariant,
      textMuted: colors.outline,
      border: colors.outlineVariant,
      borderStrong: colors.outline,
      // Paper v5 espera estes papéis extra (mantidos com os valores da seed)
      surfaceDisabled: colors.onSurface,
      onSurfaceDisabled: colors.outline,
      backdrop: colors.scrim,
    },
    fonts: {
      ...base.fonts,
      ...typography,
    },
    roundness: 12,
  };
};

export const lightTheme = createPaperTheme(false);
export const darkTheme = createPaperTheme(true);
