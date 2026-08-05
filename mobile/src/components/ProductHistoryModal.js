import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Portal, Modal, Surface, Text, IconButton, Divider, Card, Badge, ActivityIndicator } from 'react-native-paper';
import { LineChart } from 'react-native-chart-kit';
import axios from 'axios';
import { useLocalFuzzyMatch } from '../utils/fuzzyMatch';
import { API_BASE_URL } from '../config';
import { SUPERMARKET_BRANDS, getSupermarket } from './ProductCard';
import { colors } from '../theme';

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
};

const ProductHistoryModal = ({ product, visible, onDismiss, isFavorite, onToggleFavorite }) => {
  const [history, setHistory] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  // Hook reativo para preços cruzados offline
  const { matches: crossPrices, loading: crossLoading } = useLocalFuzzyMatch(product);

  useEffect(() => {
    let isMounted = true;
    
    if (visible && product) {
      const fetchHistory = async () => {
        setFetching(true);
        setNetworkError(false);
        try {
          // Chamada permitida à API local
          const response = await axios.get(`${API_BASE_URL}/api/products/${product.id}`, { timeout: 8000 });
          if (isMounted && response.data && response.data.price_history) {
            setHistory(response.data.price_history);
          }
        } catch (e) {
          console.error("[ProductHistoryModal Fetch Error]:", e);
          if (isMounted) {
            setNetworkError(true);
          }
        } finally {
          if (isMounted) {
            setFetching(false);
          }
        }
      };
      
      fetchHistory();
    } else {
      // Limpar estados ao fechar para poupar RAM
      setHistory([]);
      setNetworkError(false);
      setFetching(false);
    }

    return () => {
      isMounted = false;
    };
  }, [visible, product]);

  const brandInfo = product ? getSupermarket(product.supermarketId) : { name: '', color: colors.textMuted };

  // Calcular estatísticas de preços
  const stats = useMemo(() => {
    if (!product) return { min: 0, max: 0, current: 0 };
    const currentPrice = parseFloat(product.price);
    
    if (!history || history.length === 0) {
      return { min: currentPrice, max: currentPrice, current: currentPrice };
    }

    const prices = history.map(item => parseFloat(item.price));
    return {
      min: Math.min(...prices, currentPrice),
      max: Math.max(...prices, currentPrice),
      current: currentPrice,
    };
  }, [history, product]);

  // Formatar dados para o gráfico de linha de forma resiliente
  const chartData = useMemo(() => {
    if (!history || history.length < 2) return null;

    // Ordenar de forma cronológica (antigo para novo)
    const sorted = [...history].reverse();
    const prices = sorted.map(item => parseFloat(item.price));
    
    // Simplificar labels para evitar overlap
    const labels = sorted.map((item, idx) => {
      if (sorted.length <= 5) {
        return formatDate(item.recorded_at);
      }
      if (idx === 0 || idx === Math.floor(sorted.length / 2) || idx === sorted.length - 1) {
        return formatDate(item.recorded_at);
      }
      return '';
    });

    return {
      labels,
      datasets: [
        {
          data: prices,
          color: (opacity = 1) => `rgba(0, 80, 170, ${opacity})`,
          strokeWidth: 3,
        }
      ]
    };
  }, [history]);

  if (!product) return null;

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={styles.modalContent}
      >
        <SafeAreaView style={{ flex: 1 }}>
          {/* Header Fixo */}
          <Surface style={styles.header} elevation={1}>
            <View style={styles.headerLeft}>
              <IconButton icon="close" size={24} onPress={onDismiss} accessibilityLabel="Fechar histórico de preços" hitSlop={8} />
              <View style={styles.headerTitleContainer}>
                <Text variant="titleMedium" style={styles.productName} numberOfLines={1} accessibilityRole="header">
                  {product.name}
                </Text>
                <Text variant="bodySmall" style={styles.productBrand}>
                  {product.brand ? `Marca: ${product.brand}` : 'Marca própria/Genérico'}
                </Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              {/* Toggle de Favoritos dentro do Modal */}
              <IconButton
                icon={isFavorite ? "heart" : "heart-outline"}
                iconColor={isFavorite ? colors.danger : colors.textMuted}
                size={22}
                style={{ marginRight: 8 }}
                onPress={() => onToggleFavorite(product, isFavorite)}
                accessibilityLabel={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                accessibilityState={{ selected: isFavorite }}
                hitSlop={8}
              />
              <Badge style={[styles.supermarketBadge, { backgroundColor: brandInfo.color }]}>
                {brandInfo.name}
              </Badge>
            </View>
          </Surface>

          <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
            {/* 1. Indicadores de Preço */}
            <Text variant="titleSmall" style={styles.sectionTitle} accessibilityRole="header">Estatísticas (Últimos 30 dias)</Text>
            <View style={styles.statsContainer}>
              <Surface style={[styles.statCard, { borderBottomColor: colors.success }]} elevation={1}>
                <Text variant="bodySmall" style={styles.statLabel}>Preço Mínimo</Text>
                <Text variant="titleLarge" style={[styles.statValue, { color: colors.success }]}>
                  {stats.min.toFixed(2)} €
                </Text>
              </Surface>
              <Surface style={[styles.statCard, { borderBottomColor: brandInfo.color }]} elevation={1}>
                <Text variant="bodySmall" style={styles.statLabel}>Preço Atual</Text>
                <Text variant="titleLarge" style={[styles.statValue, { color: brandInfo.color }]}>
                  {stats.current.toFixed(2)} €
                </Text>
              </Surface>
              <Surface style={[styles.statCard, { borderBottomColor: colors.danger }]} elevation={1}>
                <Text variant="bodySmall" style={styles.statLabel}>Preço Máximo</Text>
                <Text variant="titleLarge" style={[styles.statValue, { color: colors.danger }]}>
                  {stats.max.toFixed(2)} €
                </Text>
              </Surface>
            </View>

            {/* 2. Histórico e Gráficos */}
            <Text variant="titleSmall" style={styles.sectionTitle} accessibilityRole="header">Histórico de Preços</Text>
            {fetching ? (
              <Surface style={styles.chartPlaceholder} elevation={1}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text variant="bodyMedium" style={styles.placeholderText}>A carregar histórico...</Text>
              </Surface>
            ) : networkError ? (
              <Surface style={[styles.chartPlaceholder, { borderLeftWidth: 4, borderLeftColor: colors.danger }]} elevation={1}>
                <IconButton icon="wifi-off" size={32} iconColor={colors.danger} style={{ margin: 0 }} />
                <Text variant="bodyMedium" style={styles.errorText}>Gráfico indisponível (Erro de Conexão)</Text>
                <Text variant="bodySmall" style={styles.errorSubtext}>Verifica o servidor ou tenta mais tarde.</Text>
              </Surface>
            ) : chartData ? (
              <Surface
                style={styles.chartContainer}
                elevation={1}
                accessible
                accessibilityLabel={`Gráfico do histórico de preços. Mínimo ${stats.min.toFixed(2)} euros, atual ${stats.current.toFixed(2)} euros, máximo ${stats.max.toFixed(2)} euros.`}
              >
                <LineChart
                  data={chartData}
                  width={Dimensions.get('window').width - 32}
                  height={180}
                  chartConfig={{
                    backgroundColor: '#ffffff',
                    backgroundGradientFrom: '#ffffff',
                    backgroundGradientTo: '#ffffff',
                    decimalPlaces: 2,
                    color: (opacity = 1) => `rgba(0, 80, 170, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(100, 100, 100, ${opacity})`,
                    propsForDots: {
                      r: "4",
                      strokeWidth: "2",
                      stroke: colors.primary
                    }
                  }}
                  bezier
                  style={styles.chart}
                />
              </Surface>
            ) : (
              <Surface style={[styles.chartPlaceholder, { borderLeftWidth: 4, borderLeftColor: colors.success }]} elevation={1}>
                <IconButton icon="check-circle-outline" size={32} iconColor={colors.success} style={{ margin: 0 }} />
                <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: colors.textSecondary }}>Preço Estável nos últimos 30 dias</Text>
                <Text variant="bodySmall" style={{ color: colors.textMuted, marginTop: 4 }}>Não foi registada nenhuma oscilação neste período.</Text>
              </Surface>
            )}

            {/* 3. Comparação Cruzada (Offline) */}
            <Text variant="titleSmall" style={styles.sectionTitle} accessibilityRole="header">Preços Atuais na Concorrência (Offline)</Text>
            {crossLoading ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
            ) : (
              <Surface style={styles.crossContainer} elevation={1}>
                {Object.entries(SUPERMARKET_BRANDS).map(([sId, brandData], index) => {
                  const match = crossPrices[sId];
                  const isCurrent = sId === product.supermarketId;

                  return (
                    <View key={sId}>
                      <View style={styles.crossRow}>
                        <View style={styles.crossLeft}>
                          <Badge
                            style={[styles.miniBadge, { backgroundColor: brandData.color }]}
                            accessible={false}
                            importantForAccessibility="no-hide-descendants"
                          >
                            {brandData.name.charAt(0)}
                          </Badge>
                          <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text variant="bodyMedium" style={styles.crossSupermarketName}>
                              {brandData.name} {isCurrent && <Text style={{ color: colors.textMuted, fontSize: 12 }}>(Origem)</Text>}
                            </Text>
                            <Text variant="bodySmall" style={styles.crossProductName} numberOfLines={1}>
                              {match && match.available ? match.name : 'Não disponível'}
                            </Text>
                          </View>
                        </View>
                        <Text 
                          variant="titleMedium" 
                          style={[
                            styles.crossPrice, 
                            match && match.available ? { color: brandData.color } : { color: colors.danger }
                          ]}
                        >
                          {match && match.available ? `${match.price.toFixed(2)} €` : 'N/A'}
                        </Text>
                      </View>
                      {index < Object.keys(SUPERMARKET_BRANDS).length - 1 && <Divider />}
                    </View>
                  );
                })}
              </Surface>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalContent: {
    backgroundColor: colors.background,
    flex: 1,
    margin: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 0.65,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 0.35,
    justifyContent: 'flex-end',
  },
  headerTitleContainer: {
    marginLeft: 4,
    flex: 1,
  },
  productName: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  productBrand: {
    color: colors.textMuted,
  },
  supermarketBadge: {
    color: colors.surface,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
    borderBottomWidth: 3,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 4,
  },
  statValue: {
    fontWeight: 'bold',
  },
  chartContainer: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chart: {
    borderRadius: 8,
    marginVertical: 4,
  },
  chartPlaceholder: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  placeholderText: {
    marginTop: 8,
    color: colors.textMuted,
  },
  errorText: {
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginTop: 4,
  },
  errorSubtext: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  crossContainer: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  crossRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  crossLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 0.75,
  },
  miniBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.surface,
    fontSize: 13,
    fontWeight: 'bold',
  },
  crossSupermarketName: {
    fontWeight: '600',
    color: colors.textSecondary,
  },
  crossProductName: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  crossPrice: {
    fontWeight: 'bold',
    flex: 0.25,
    textAlign: 'right',
  },
});

export default ProductHistoryModal;
