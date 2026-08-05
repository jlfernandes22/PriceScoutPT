import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal as RNModal, ScrollView } from 'react-native';
import { Portal, Modal, Dialog, Surface, Text, IconButton, Divider, Button, ActivityIndicator, Chip } from 'react-native-paper';
import { database } from '../model';
import { colors } from '../theme';
import { syncDatabase } from '../services/sync';
import { API_BASE_URL, SCRAPE_SECRET } from '../config';
import axios from 'axios';

const ALL_SCRAPERS = ['Continente', 'Lidl', 'PingoDoce', 'Aldi'];

const SettingsModal = ({ visible, onDismiss }) => {
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [resetDialogVisible, setResetDialogVisible] = useState(false);
  const [clearDialogVisible, setClearDialogVisible] = useState(false);

  // Estado do re-scrape sob demanda
  const [selectedScrapers, setSelectedScrapers] = useState(ALL_SCRAPERS);
  const [scrapeJob, setScrapeJob] = useState(null);
  const [scrapeRunning, setScrapeRunning] = useState(false);
  const pollTimer = useRef(null);

  useEffect(() => {
    if (!visible) {
      setScrapeJob(null);
      setScrapeRunning(false);
      if (pollTimer.current) clearInterval(pollTimer.current);
    }
  }, [visible]);

  const toggleScraper = (name) => {
    setSelectedScrapers((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  };

  // Disparar recolha fresca no servidor (POST /api/scrape)
  const handleScrape = async () => {
    if (scrapeRunning) return;
    setScrapeRunning(true);
    setScrapeJob({ status: 'running', scrapers: selectedScrapers, log_tail: [] });
    try {
      const response = await axios.post(`${API_BASE_URL}/api/scrape`, {
        scrapers: selectedScrapers,
      }, {
        timeout: 15000,
        headers: SCRAPE_SECRET ? { 'x-scrape-secret': SCRAPE_SECRET } : {},
      });
      const { job_id } = response.data;
      pollTimer.current = setInterval(async () => {
        try {
          const status = await axios.get(`${API_BASE_URL}/api/scrape/status/${job_id}`, { timeout: 8000 });
          setScrapeJob(status.data);
          if (status.data.status === 'completed' || status.data.status === 'failed') {
            clearInterval(pollTimer.current);
            setScrapeRunning(false);
            // Refrescar o catálogo local com os dados novos
            try {
              setLoadingText('A sincronizar catálogo local com os dados novos...');
              await syncDatabase(database);
            } catch (e) {
              console.error("[Settings Scrape Sync Error]:", e);
            }
          }
        } catch (e) {
          console.error("[Settings Scrape Poll Error]:", e);
        }
      }, 5000);
    } catch (e) {
      console.error("[Settings Scrape Start Error]:", e);
      setScrapeRunning(false);
      if (e.response && e.response.status === 409) {
        setScrapeJob({ status: 'failed', error: 'Já existe uma recolha em curso no servidor.' });
      } else {
        setScrapeJob({ status: 'failed', error: 'Não foi possível contactar o servidor.' });
      }
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

  const scrapeDone = scrapeJob && (scrapeJob.status === 'completed' || scrapeJob.status === 'failed');
  const lastLogLines = scrapeJob && scrapeJob.log_tail ? scrapeJob.log_tail.slice(-4) : [];

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

          <ScrollView contentContainerStyle={styles.content}>

            {/* Secção: Recolha Fresca de Dados */}
            <Text variant="titleSmall" style={styles.sectionLabel}>Atualizar Preços (Recolha Fresca)</Text>
            <Text variant="bodySmall" style={styles.helpText}>
              Dispara uma nova recolha de preços diretamente dos sites dos supermercados no servidor.
              Usa a versão em cache (offline) para uso rápido, ou atualiza agora para preços de hoje.
            </Text>
            <View style={styles.scraperChips}>
              {ALL_SCRAPERS.map((name) => (
                <Chip
                  key={name}
                  selected={selectedScrapers.includes(name)}
                  onPress={() => toggleScraper(name)}
                  style={[styles.scraperChip, { backgroundColor: selectedScrapers.includes(name) ? colors.primary : colors.surfaceVariant }]}
                  selectedColor={colors.surface}
                  showSelectedOverlay={false}
                  textStyle={{ color: selectedScrapers.includes(name) ? colors.surface : colors.textSecondary, fontSize: 12 }}
                  accessibilityState={{ selected: selectedScrapers.includes(name) }}
                >
                  {name}
                </Chip>
              ))}
            </View>
            <Button
              mode="contained"
              icon={scrapeRunning ? 'progress-download' : 'cloud-download-outline'}
              buttonColor={colors.primary}
              textColor={colors.surface}
              style={styles.actionButton}
              contentStyle={styles.buttonContent}
              disabled={scrapeRunning || selectedScrapers.length === 0}
              onPress={handleScrape}
            >
              {scrapeRunning ? 'A recolher dados...' : 'Atualizar Agora'}
            </Button>

            {scrapeJob && scrapeJob.status === 'running' && (
              <Surface style={styles.jobCard} elevation={1}>
                <View style={styles.jobHeader}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text variant="bodyMedium" style={styles.jobText}>
                    A recolher dados de: {scrapeJob.scrapers.join(', ')}
                  </Text>
                </View>
                {lastLogLines.map((line, i) => (
                  <Text key={i} variant="bodySmall" numberOfLines={1} style={styles.jobLogLine}>
                    {line}
                  </Text>
                ))}
              </Surface>
            )}
            {scrapeDone && (
              <Surface
                style={[
                  styles.jobCard,
                  { borderLeftWidth: 4, borderLeftColor: scrapeJob.status === 'completed' ? colors.success : colors.danger },
                ]}
                elevation={1}
              >
                <Text variant="bodyMedium" style={styles.jobText}>
                  {scrapeJob.status === 'completed'
                    ? '✓ Recolha concluída! Catálogo local sincronizado.'
                    : `✗ Recolha falhou: ${scrapeJob.error || `exit code ${scrapeJob.exit_code}`}`}
                </Text>
                {scrapeJob.log_tail && scrapeJob.log_tail.slice(-3).map((line, i) => (
                  <Text key={i} variant="bodySmall" numberOfLines={1} style={styles.jobLogLine}>
                    {line}
                  </Text>
                ))}
              </Surface>
            )}

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
              <Text variant="titleMedium" style={styles.aboutTitle}>PriceScoutPT v1.1.0</Text>
              <Text variant="bodyMedium" style={styles.aboutCredits}>
                Comparador de preços de supermercados em Portugal (Continente, Lidl, Pingo Doce, Aldi)
                com catálogo offline-first e recolha de dados sob demanda.
              </Text>
              <Text variant="bodySmall" style={styles.disclaimer}>
                Os preços são recolhidos dos sites públicos dos supermercados e podem variar.
              </Text>
            </Surface>
          </ScrollView>
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
  scraperChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  scraperChip: {
    marginRight: 6,
    marginBottom: 6,
    borderRadius: 16,
    height: 32,
  },
  actionButton: {
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  buttonContent: {
    height: 48,
  },
  jobCard: {
    backgroundColor: colors.syncOverlay,
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  jobText: {
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: 8,
    flex: 1,
  },
  jobLogLine: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
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
