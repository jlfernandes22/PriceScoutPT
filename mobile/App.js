import React, { useEffect, useState } from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider, BottomNavigation, ActivityIndicator, Text, Icon } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from './src/model';
import { syncDatabase } from './src/services/sync';
import { paperTheme, colors, spacing } from './src/theme';

import SearchScreen from './src/screens/SearchScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import CompareScreen from './src/screens/CompareScreen';
import BasketScreen from './src/screens/BasketScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';

export default function App() {
  return (
    <AppContent />
  );
}

function AppContent() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);

  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'search', title: 'Pesquisar', focusedIcon: 'magnify', unfocusedIcon: 'magnify' },
    { key: 'favorites', title: 'Favoritos', focusedIcon: 'heart', unfocusedIcon: 'heart-outline' },
    { key: 'compare', title: 'Comparar', focusedIcon: 'scale-balance', unfocusedIcon: 'scale-balance' },
    { key: 'basket', title: 'Meu Cabaz', focusedIcon: 'cart', unfocusedIcon: 'cart-outline' },
  ]);

  const runSync = async (background = false) => {
    if (!background) {
      setIsLoading(true);
    }
    setHasOnboarded(true);
    try {
      await syncDatabase(database, { onProgress: background ? null : setSyncProgress });
    } catch (error) {
      console.error('[App] Erro na sincronização:', error);
    } finally {
      setIsLoading(false);
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

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
          <View style={styles.loaderContainer}>
            <View style={styles.loaderLogo}>
              <Icon source="cart" size={44} color={colors.surface} />
            </View>
            <Text variant="titleLarge" style={styles.loaderTitle}>PriceScoutPT</Text>
            <Text variant="bodyMedium" style={styles.loaderSubtitle}>
              Compara preços dos supermercados portugueses
            </Text>
            <ActivityIndicator size="large" color={colors.primary} style={styles.loaderSpinner} />
            <Text variant="bodySmall" style={styles.loaderStatus}>
              {syncProgress && syncProgress.total > 0
                ? `A descarregar o catálogo… ${syncProgress.done} de ${syncProgress.total} registos`
                : 'A preparar o catálogo…'}
            </Text>
          </View>
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  if (!hasOnboarded) {
    return (
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
          <OnboardingScreen onComplete={runSync} />
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  // Removido o DatabaseProvider obsoleto!
  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <BottomNavigation
          navigationState={{ index, routes }}
          onIndexChange={setIndex}
          renderScene={renderScene}
          shifting={true}
          labeled={true}
          barStyle={styles.tabBar}
        />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
