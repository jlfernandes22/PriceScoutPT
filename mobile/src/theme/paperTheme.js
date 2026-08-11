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
