// SHIM de compatibilidade (temporário): os ecrãs ainda importam `{ colors }`
// daqui até ao "color pass" (passo 5 da migração MD3). Valores derivados
// dos tokens — o objetivo é migrar tudo para useTheme() e eliminar este ficheiro.
import { lightColors, spacing, shape } from './theme/tokens';

export const colors = {
  ...lightColors,
  primary: lightColors.primary,
  primaryContainer: lightColors.primaryContainer,
  secondary: lightColors.secondary,
  success: lightColors.tertiary,
  successContainer: lightColors.tertiaryContainer,
  danger: lightColors.error,
  dangerContainer: lightColors.errorContainer,
  warning: lightColors.onErrorContainer,
  background: lightColors.background,
  surface: lightColors.surface,
  surfaceVariant: lightColors.surfaceVariant,
  border: lightColors.outlineVariant,
  borderStrong: lightColors.outline,
  textPrimary: lightColors.onSurface,
  textSecondary: lightColors.onSurfaceVariant,
  textMuted: lightColors.outline,
  gold: lightColors.tertiary,
};

export const spacing = spacing;
export const radius = shape;

export { lightTheme as paperTheme } from './theme/paperTheme';
