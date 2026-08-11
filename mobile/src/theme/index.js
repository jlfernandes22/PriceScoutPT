// Tema: contexto de modo (sistema / claro / escuro) + helpers de uso.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme } from './paperTheme';
import { supermarketBrands, DEFAULT_BRAND_COLOR, spacing, shape } from './tokens';

export const THEME_MODE_KEY = '@theme_mode';

const ThemeModeContext = createContext({
  mode: 'system',
  setMode: () => {},
  isDark: false,
  theme: lightTheme,
});

export const ThemeModeProvider = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(THEME_MODE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setMode = (next) => {
    setModeState(next);
    AsyncStorage.setItem(THEME_MODE_KEY, next).catch(() => {});
  };

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isDark,
      theme: isDark ? darkTheme : lightTheme,
    }),
    [mode, isDark]
  );

  return (
    <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
  );
};

export const useAppTheme = () => useContext(ThemeModeContext);

// Helper: cor de um supermercado pela sua PK (tokens, nunca hex em screens).
export const getSupermarketColor = (supermarketId) =>
  (supermarketBrands[supermarketId] && supermarketBrands[supermarketId].color) ||
  DEFAULT_BRAND_COLOR;

export const getSupermarketName = (supermarketId) =>
  (supermarketBrands[supermarketId] && supermarketBrands[supermarketId].name) ||
  'Supermercado';

export { lightTheme, darkTheme, spacing, shape };
