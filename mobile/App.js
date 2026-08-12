import 'react-native-gesture-handler'; // obrigatório antes de qualquer navegação

import React, { useEffect, useState } from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme as RNDefaultTheme, DarkTheme as RNDarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, BottomNavigation, ActivityIndicator, Text, Icon, ProgressBar } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from './src/model';
import { syncDatabase } from './src/services/sync';
import { ThemeModeProvider, useAppTheme, spacing } from './src/theme';
import { M3LoadingIndicator, WavyProgress } from './src/theme/loading';
import { SyncStateProvider, useSyncState } from './src/services/syncState';

import SearchScreen from './src/screens/SearchScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import CompareScreen from './src/screens/CompareScreen';
import BasketScreen from './src/screens/BasketScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProductHistoryScreen from './src/screens/ProductHistoryScreen';

const Stack = createNativeStackNavigator();
const MIN_SYNC_LOADING_MS = 1200;

export default function App() {
  return (
    <ThemeModeProvider>
      <SyncStateProvider>
        <AppContent />
      </SyncStateProvider>
    </ThemeModeProvider>
  );
}

function AppContent() {
  const { theme, isDark } = useAppTheme();
  const { setSyncState } = useSyncState();
  const colors = theme.colors;
  const styles = createStyles(colors, spacing);
  const [isLoading, setIsLoading] = useState(true);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);

  const runSync = async (background = false) => {
    if (!background) {
      setIsLoading(true);
    }
    setHasOnboarded(true);
    setSyncState(true);
    const startedAt = Date.now();
    try {
      await syncDatabase(database, { onProgress: background ? null : setSyncProgress });
    } catch (error) {
      console.error('[App] Erro na sincronização:', error);
    } finally {
      // Tempo mínimo visível do loading MD3 (mesmo para deltas instantâneos)
      const remaining = Math.max(0, MIN_SYNC_LOADING_MS - (Date.now() - startedAt));
      setTimeout(() => {
        setIsLoading(false);
        setSyncState(false);
      }, remaining);
    }
  };

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const completed = await AsyncStorage.getItem('@onboarding_completed');
        if (completed === 'true') {
          // Utilizador recorrente. Se já existe catálogo local, mostra a app
          // IMEDIATAMENTE (offline-first) e sincroniza em segundo plano — o
          // ecrã de carregamento só bloqueia quando não há dados (1ª vez).
          const hasLocalData = (await database.collections.get('products').query().fetchCount()) > 0;
          if (hasLocalData) {
            setHasOnboarded(true);
            setIsLoading(false);
            runSync(true);
          } else {
            await runSync(false);
          }
        } else {
          // Primeira utilização: segue para o onboarding (o sync inicia no fim).
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[App] Erro na inicialização da aplicação:', error);
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.background} />
          <View style={styles.loaderContainer}>
            <View style={styles.loaderLogo}>
              <Icon source="cart" size={44} color={colors.surface} />
            </View>
            <Text variant="titleLarge" style={styles.loaderTitle}>PriceScoutPT</Text>
            <Text variant="bodyMedium" style={styles.loaderSubtitle}>
              Compara preços dos supermercados portugueses
            </Text>
            {syncProgress && syncProgress.total > 0 ? (
              <>
                <ProgressBar
                  progress={syncProgress.done / syncProgress.total}
                  color={colors.primary}
                  style={styles.loaderProgress}
                />
                <Text variant="bodySmall" style={styles.loaderStatus}>
                  {`A descarregar o catálogo… ${syncProgress.done} de ${syncProgress.total} registos`}
                </Text>
              </>
            ) : (
              <>
                <M3LoadingIndicator size={40} style={styles.loaderSpinner} />
                <WavyProgress style={styles.loaderWavy} />
                <Text variant="bodySmall" style={styles.loaderStatus}>A preparar o catálogo…</Text>
              </>
            )}
          </View>
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  if (!hasOnboarded) {
    return (
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.background} />
          <OnboardingScreen onComplete={runSync} />
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  // Removido o DatabaseProvider obsoleto!
  const navTheme = (isDark ? RNDarkTheme : RNDefaultTheme);
  const navigationTheme = {
    ...navTheme,
    colors: {
      ...navTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.onSurface,
      border: colors.outlineVariant,
      notification: colors.error,
    },
  };

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.background} />
        <NavigationContainer theme={navigationTheme}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="ProductHistory"
              component={ProductHistoryScreen}
              options={{ animation: 'slide_from_bottom', gestureEnabled: true }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

// Usamos um switch manual para evitar falhas do SceneMap
const renderScene = ({ route, jumpTo }) => {
  switch (route.key) {
    case 'search':
      return SearchScreen ? <SearchScreen jumpTo={jumpTo} /> : <View />;
    case 'favorites':
      return FavoritesScreen ? <FavoritesScreen jumpTo={jumpTo} /> : <View />;
    case 'compare':
      return CompareScreen ? <CompareScreen jumpTo={jumpTo} /> : <View />;
    case 'basket':
      return BasketScreen ? <BasketScreen jumpTo={jumpTo} /> : <View />;
    default:
      return null;
  }
};

// Componente de tabs estável (módulo-level) — AppContent re-renders não o
// remontam, evitando fechar modais/estado dos ecrãs.
function MainTabs() {
  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'search', title: 'Pesquisar', focusedIcon: 'magnify', unfocusedIcon: 'magnify' },
    { key: 'favorites', title: 'Favoritos', focusedIcon: 'heart', unfocusedIcon: 'heart-outline' },
    { key: 'compare', title: 'Comparar', focusedIcon: 'scale-balance', unfocusedIcon: 'scale-balance' },
    { key: 'basket', title: 'Meu Cabaz', focusedIcon: 'cart', unfocusedIcon: 'cart-outline' },
  ]);

  const { theme } = useAppTheme();
  const colors = theme.colors;
  const styles = createStyles(colors, spacing);

  return (
    <BottomNavigation
      navigationState={{ index, routes }}
      onIndexChange={setIndex}
      renderScene={renderScene}
      shifting={true}
      labeled={true}
      barStyle={styles.tabBar}
    />
  );
}

const createStyles = (colors, spacing) => StyleSheet.create({
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
  },
  loaderLogo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  loaderTitle: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  loaderSubtitle: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  loaderSpinner: {
    marginTop: spacing.xl,
  },
  loaderProgress: {
    marginTop: spacing.xl,
    width: '80%',
    alignSelf: 'center',
    height: 6,
    borderRadius: 3,
  },
  loaderWavy: {
    marginTop: spacing.xl,
    width: '60%',
    alignSelf: 'center',
  },
  loaderStatus: {
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
