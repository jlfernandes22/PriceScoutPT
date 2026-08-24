import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StatusBar, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider, BottomNavigation, ActivityIndicator, Text, Icon } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from './src/model';
import { syncDatabase } from './src/services/sync';
import { loadApiBaseUrl } from './src/config';
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
  const [isResetting, setIsResetting] = useState(false);

  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'search', title: 'Pesquisar', focusedIcon: 'magnify', unfocusedIcon: 'magnify' },
    { key: 'favorites', title: 'Favoritos', focusedIcon: 'heart', unfocusedIcon: 'heart-outline' },
    { key: 'compare', title: 'Comparar', focusedIcon: 'scale-balance', unfocusedIcon: 'scale-balance' },
    { key: 'basket', title: 'Meu Cabaz', focusedIcon: 'cart', unfocusedIcon: 'cart-outline' },
  ]);

  // Single-flight para a sync: dois toques rápidos em "Começar a Poupar"/
  // "Saltar" (ou pull-to-refresh durante o arranque) não podem lançar duas
  // sincronizações completas concorrentes — duplicava o download do catálogo.
  const syncInFlightRef = useRef(false);

  const runSync = async (background = false) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    if (!background) {
      setIsLoading(true);
    }
    setHasOnboarded(true);
    try {
      await syncDatabase(database, { onProgress: background ? null : setSyncProgress });
    } catch (error) {
      console.error('[App] Erro na sincronização:', error);
    } finally {
      syncInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  // Reposição da base de dados vivendo AQUI (não no SettingsModal) porque o
  // unsafeResetDatabase() falha/corrompe dados se houver subscritores ativos
  // ("Unexpected N Database subscribers were detected..."). Desmontar os
  // separadores (isResetting) liberta os observers do withObservables antes
  // do reset — sem isto, a reposição deixava registos órfãos e a sync seguinte
  // duplicava categorias/produtos (ids antigos + novos a coexistir).
  const handleResetDatabase = useCallback(async () => {
    if (isResetting) return;
    setIsResetting(true);
    // Um tick para o React desmontar os ecrãs e libertar as subscrições.
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await database.write(async () => {
        await database.unsafeResetDatabase();
      });
      await syncDatabase(database, { onProgress: setSyncProgress });
    } catch (error) {
      console.error('[App] Erro na reposição da base de dados:', error);
    } finally {
      setIsResetting(false);
      setIsLoading(false);
    }
  }, [isResetting]);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Carregar o servidor escolhido pelo utilizador (self-hosted) ANTES de
        // qualquer pedido de rede (sync/histórico/status).
        await loadApiBaseUrl();
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
        return SearchScreen ? <SearchScreen jumpTo={jumpTo} onResetDatabase={handleResetDatabase} /> : <View />;
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

  if (isLoading || isResetting) {
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
              {isResetting ? 'A repor a base de dados local…' : 'Compara preços dos supermercados portugueses'}
            </Text>
            <ActivityIndicator size="large" color={colors.primary} style={styles.loaderSpinner} />
            <Text variant="bodySmall" style={styles.loaderStatus}>
              {syncProgress && syncProgress.total > 0
                ? `A descarregar o catálogo… ${syncProgress.done} de ${syncProgress.total} registos`
                : syncProgress && syncProgress.done > 0
                  ? `A descarregar o catálogo… ${syncProgress.done} registos recebidos`
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
