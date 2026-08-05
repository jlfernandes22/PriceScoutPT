import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal as RNModal } from 'react-native';
import { Portal, Modal, Dialog, Surface, Text, IconButton, Divider, Button, ActivityIndicator } from 'react-native-paper';
import axios from 'axios';
import Constants from 'expo-constants';
import { database } from '../model';
import { colors } from '../theme';
import { API_BASE_URL } from '../config';
import { syncDatabase } from '../services/sync';

const formatLastScrape = (iso) => {
  if (!iso) return 'Ainda sem recolha registada.';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const appVersion = Constants.expoConfig?.version || '1.0.0';

const SettingsModal = ({ visible, onDismiss }) => {
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [syncingNow, setSyncingNow] = useState(false);
  const [lastScrapeAt, setLastScrapeAt] = useState(null);
  const [resetDialogVisible, setResetDialogVisible] = useState(false);
  const [clearDialogVisible, setClearDialogVisible] = useState(false);

  // A recolha diária corre no servidor (agendada às ~13:00). O botão só
  // descarrega os dados mais recentes; a hora da última recolha lê-se uma vez
  // ao abrir o painel (sem polling contínuo).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    axios
      .get(`${API_BASE_URL}/api/scrape/status`, { timeout: 10000 })
      .then((res) => {
        if (!cancelled) setLastScrapeAt(res.data.last_scrape_at || null);
      })
      .catch(() => {
        if (!cancelled) setLastScrapeAt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleSync = async () => {
    if (syncingNow) return;
    setSyncingNow(true);
    try {
      await syncDatabase(database);
    } catch (e) {
      console.error('[Settings Sync Error]:', e);
    } finally {
      setSyncingNow(false);
    }
  };

  const handleResetDatabase = () => setResetDialogVisible(true);

  const executeResetDatabase = async () => {
    setResetDialogVisible(false);
    setLoadingText('A apagar base de dados local...');
    setLoading(true);
    try {
      await database.write(async () => {
        await database.unsafeResetDatabase();
      });
      setLoadingText('A descarregar catálogo do servidor...');
      await syncDatabase(database);
    } catch (e) {
      console.error("[Settings Reset Database Error]:", e);
    } finally {
      setLoading(false);
      onDismiss();
    }
  };

  const handleClearFavorites = () => setClearDialogVisible(true);

  const executeClearFavorites = async () => {
    setClearDialogVisible(false);
    setLoadingText('A remover favoritos...');
    setLoading(true);
    try {
      await database.write(async () => {
        const favs = await database.collections.get('favorites').query().fetch();
        for (const fav of favs) {
          await fav.destroyPermanently();
        }
      });
    } catch (e) {
      console.error("[Settings Clear Favorites Error]:", e);
    } finally {
      setLoading(false);
      onDismiss();
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible && !loading}
        onDismiss={onDismiss}
        contentContainerStyle={styles.modalContent}
      >
        <Surface style={styles.container} elevation={2}>
          <View style={styles.header}>
            <Text variant="titleLarge" style={styles.headerTitle}>Painel de Controlo</Text>
            <IconButton icon="close" size={24} onPress={onDismiss} style={styles.closeIcon} accessibilityLabel="Fechar painel de controlo" hitSlop={8} />
          </View>
          <Divider />

          <View style={styles.content}>

            {/* Secção: Sincronização */}
            <Text variant="titleSmall" style={styles.sectionLabel}>Sincronização</Text>
            <Text variant="bodySmall" style={styles.helpText}>
              O servidor recolhe os preços automaticamente todos os dias às ~13:00. Usa o botão abaixo para
              descarregar os dados mais recentes já recolhidos.
            </Text>
            <Button
              mode="contained"
              icon="cloud-download-outline"
              buttonColor={colors.primary}
              textColor={colors.surface}
              style={styles.actionButton}
              contentStyle={styles.buttonContent}
              loading={syncingNow}
              disabled={syncingNow}
              onPress={handleSync}
            >
              {syncingNow ? 'A sincronizar...' : 'Sincronizar Agora'}
            </Button>

            <Surface style={styles.lastScrapeCard} elevation={1}>
              <Text variant="bodySmall" style={styles.lastScrapeLabel}>Última recolha no servidor</Text>
              <Text variant="bodyMedium" style={styles.lastScrapeValue}>
                {formatLastScrape(lastScrapeAt)}
              </Text>
            </Surface>

            <Divider style={styles.divider} />

            {/* Secção: Manutenção de Dados */}
            <Text variant="titleSmall" style={styles.sectionLabel}>Manutenção de Dados</Text>

            <Button
              mode="contained"
              icon="database-sync"
              buttonColor={colors.danger}
              textColor={colors.surface}
              style={styles.actionButton}
              contentStyle={styles.buttonContent}
              onPress={handleResetDatabase}
            >
              Forçar Sincronização Completa
            </Button>
            <Text variant="bodySmall" style={styles.helpText}>
              Apaga todo o SQLite local e faz uma nova sincronização limpa do catálogo do servidor.
            </Text>

            <Button
              mode="outlined"
              icon="heart-broken"
              textColor={colors.danger}
              style={[styles.actionButton, { borderColor: colors.danger }]}
              contentStyle={styles.buttonContent}
              onPress={handleClearFavorites}
            >
              Limpar Todos os Favoritos
            </Button>
            <Text variant="bodySmall" style={styles.helpText}>
              Remove permanentemente todos os produtos guardados nos favoritos.
            </Text>

            <Divider style={styles.divider} />

            {/* Secção Sobre */}
            <Text variant="titleSmall" style={styles.sectionLabel}>Sobre a Aplicação</Text>
            <Surface style={styles.aboutCard} elevation={1}>
              <Text variant="titleMedium" style={styles.aboutTitle}>PriceScoutPT v{appVersion}</Text>
              <Text variant="bodyMedium" style={styles.aboutCredits}>
                Comparador de preços de supermercados em Portugal (Continente, Lidl, Pingo Doce, Aldi, Auchan)
                com catálogo offline-first e recolha diária automática no servidor.
              </Text>
              <Text variant="bodySmall" style={styles.disclaimer}>
                Os preços são recolhidos dos sites públicos dos supermercados e podem variar.
              </Text>
            </Surface>
          </View>
        </Surface>
      </Modal>

      <RNModal visible={loading} transparent={true} animationType="fade">
        <View style={styles.overlayBg}>
          <Surface style={styles.overlayContainer} elevation={4}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text variant="bodyLarge" style={styles.overlayText}>{loadingText}</Text>
          </Surface>
        </View>
      </RNModal>

      <Dialog visible={resetDialogVisible} onDismiss={() => setResetDialogVisible(false)} style={{ backgroundColor: colors.surface }}>
        <Dialog.Title>Forçar Sincronização</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">Tem a certeza? Isto irá apagar todos os dados offline (incluindo favoritos) e forçar uma nova descarga completa de produtos do catálogo.</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button textColor={colors.textMuted} onPress={() => setResetDialogVisible(false)}>Cancelar</Button>
          <Button textColor={colors.danger} onPress={executeResetDatabase}>Confirmar Reposição</Button>
        </Dialog.Actions>
      </Dialog>

      <Dialog visible={clearDialogVisible} onDismiss={() => setClearDialogVisible(false)} style={{ backgroundColor: colors.surface }}>
        <Dialog.Title>Limpar Favoritos</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">Tem a certeza que pretende apagar permanentemente todos os favoritos da sua lista?</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button textColor={colors.textMuted} onPress={() => setClearDialogVisible(false)}>Cancelar</Button>
          <Button textColor={colors.danger} onPress={executeClearFavorites}>Limpar Todos</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalContent: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 12,
  },
  headerTitle: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  closeIcon: {
    margin: 0,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  helpText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  actionButton: {
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  buttonContent: {
    height: 48,
  },
  lastScrapeCard: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
  },
  lastScrapeLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  lastScrapeValue: {
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
  },
  divider: {
    marginVertical: 14,
  },
  aboutCard: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  aboutTitle: {
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  aboutCredits: {
    color: colors.textSecondary,
    lineHeight: 20,
    fontSize: 13,
  },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 10,
    lineHeight: 16,
  },
  overlayBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    width: 260,
  },
  overlayText: {
    marginTop: 16,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default SettingsModal;
