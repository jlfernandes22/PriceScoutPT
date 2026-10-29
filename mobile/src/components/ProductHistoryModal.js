import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Portal, Modal, Surface, Text, IconButton, Icon, Divider, Badge, ActivityIndicator, Button } from 'react-native-paper';
import { LineChart } from 'react-native-chart-kit';
import axios from 'axios';
import { useLocalFuzzyMatch } from '../utils/fuzzyMatch';
import { computeUnitPrice } from '../utils/unitPrice';
import { getApiBaseUrl } from '../config';
import { getSupermarket, ProductImage, getProductSourceInfo, productUnitPrice } from './ProductCard';
import { colors, rgba } from '../theme';
import { formatInformationForProduct } from '../utils/productInformation';

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
};

const ProductHistoryModal = ({ product, visible, onDismiss, isFavorite, onToggleFavorite }) => {
  const [history, setHistory] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [detailResponse, setDetailResponse] = useState(null);

  // Hook reativo para preços cruzados offline
  const { matches: crossPrices, loading: crossLoading } = useLocalFuzzyMatch(visible ? product : null);

  // Largura da janela reativa (rotação/split-screen) — Dimensions.get() capturado
  // no render ficava congelado ao valor do primeiro render.
  const { width: windowWidth } = useWindowDimensions();

  useEffect(() => {
    let isMounted = true;
    
    if (visible && product) {
      const fetchHistory = async () => {
        setFetching(true);
        setNetworkError(false);
        setHistory([]);
        setDetailResponse(null);
        try {
          // Chamada permitida à API local
          const response = await axios.get(`${getApiBaseUrl()}/api/products/${product.id}`, { timeout: 8000 });
          if (isMounted && response.data) {
            setHistory(Array.isArray(response.data.price_history) ? response.data.price_history : []);
            setDetailResponse({ productId: product.id, data: response.data });
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
      setDetailResponse(null);
      setNetworkError(false);
      setFetching(false);
    }

    return () => {
      isMounted = false;
    };
  }, [visible, product]);

  const brandInfo = product ? getSupermarket(product.supermarketId) : { name: '', color: colors.textMuted };
  const sourceInfo = product ? getProductSourceInfo(product) : '';
  const displayedUnitPrice = product ? productUnitPrice(product) : '';
  const comparedStores = Object.keys(crossPrices);
  const information = formatInformationForProduct(product, detailResponse);
  const hasProductInformation = information.description || information.barcode || information.ingredients || information.allergens
    || information.nutritionText || information.nutritionRows.length > 0;

  // Deteção de peso/volume/unidade e preço por unidade (€/kg, €/l, €/un)
  // para comparar o valor real de produtos com pesos diferentes.
  const unitInfo = product ? computeUnitPrice(product.price, product.unit, product.name) : null;
  const unitText = product
    ? (unitInfo ? unitInfo.parsed.totalText : (product.unit && product.unit.trim() !== '' ? product.unit : null))
    : null;
  const unitLabel = unitInfo
    ? (unitInfo.label === '€/kg' ? 'Preço por kg' : unitInfo.label === '€/l' ? 'Preço por litro' : 'Preço por unidade')
    : 'Preço por unidade';

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
          color: (opacity = 1) => rgba(colors.primary, opacity),
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
                  {product.unit && product.unit.trim() !== '' ? ` · ${product.unit}` : ''}
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
            {(sourceInfo || product.requiresLoyaltyCard) && (
              <Text variant="bodySmall" style={styles.sourceInfo}>
                {sourceInfo}{product.requiresLoyaltyCard ? `${sourceInfo ? ' · ' : ''}Preço com cartão` : ''}
              </Text>
            )}
            {/* 0. Imagem do Produto */}
            <View style={styles.imageSection} accessible={false} importantForAccessibility="no-hide-descendants">
              <View style={[styles.detailImageWrap, { borderColor: brandInfo.color }]}>
                <ProductImage url={product.imageUrl} color={brandInfo.color} size={170} />
              </View>
            </View>

            {/* 0.5 Peso / Volume e Preço por Unidade */}
            {(unitText || displayedUnitPrice) && (
              <Surface style={styles.unitCard} elevation={1}>
                {/* Icon (Paper v5) usa `source`, não `icon` — com a prop errada
                    o ícone devolvia null e não renderizava nada. */}
                <Icon source="scale-balance" size={22} color={brandInfo.color} />
                <View style={styles.unitColLeft}>
                  <Text variant="bodySmall" style={styles.unitLabel}>Peso / Volume</Text>
                  <Text variant="titleSmall" style={styles.unitValue}>{unitText || 'Não indicado'}</Text>
                </View>
                <View style={styles.unitColRight}>
                  <Text variant="bodySmall" style={styles.unitLabel}>{unitLabel}</Text>
                  <Text variant="titleSmall" style={[styles.unitValue, { color: brandInfo.color }]}>
                    {displayedUnitPrice || '—'}
                  </Text>
                </View>
              </Surface>
            )}

            {hasProductInformation && (
              <>
                <Text variant="titleSmall" style={styles.sectionTitle} accessibilityRole="header">Informação do produto</Text>
                <Surface style={styles.informationCard} elevation={1}>
                  {information.description && <Text variant="bodyMedium" style={styles.informationText} selectable>{information.description}</Text>}
                  {information.barcode && <Text variant="bodySmall" style={styles.informationText} selectable>Código de barras: {information.barcode}</Text>}
                  {information.ingredients && <View style={styles.informationSection}>
                    <Text variant="titleSmall" style={styles.informationLabel}>Ingredientes</Text>
                    <Text variant="bodyMedium" style={styles.informationText} selectable>{information.ingredients}</Text>
                  </View>}
                  {information.allergens && <View style={styles.informationSection}>
                    <Text variant="titleSmall" style={styles.informationLabel}>Alergénios</Text>
                    <Text variant="bodyMedium" style={styles.informationText} selectable>{information.allergens}</Text>
                  </View>}
                  {(information.nutritionText || information.nutritionRows.length > 0) && <View style={styles.informationSection}>
                    <Text variant="titleSmall" style={styles.informationLabel}>Informação nutricional</Text>
                    {information.nutritionBasis && <Text variant="bodySmall" style={styles.informationText}>Base: {information.nutritionBasis}</Text>}
                    {information.servingSize && <Text variant="bodySmall" style={styles.informationText}>Dose: {information.servingSize}</Text>}
                    {information.nutritionText && <Text variant="bodyMedium" style={styles.informationText} selectable>{information.nutritionText}</Text>}
                    {information.nutritionRows.map((row, index) => <View key={`${row.label}-${index}`} style={styles.nutritionRow}>
                      <Text variant="bodyMedium" style={styles.nutritionLabel}>{row.label}</Text>
                      <Text variant="bodyMedium" style={styles.nutritionValue} selectable>{row.value}</Text>
                    </View>)}
                  </View>}
                </Surface>
              </>
            )}
            {information.sourceUrl && <Button icon="open-in-new" onPress={() => Linking.openURL(information.sourceUrl).catch(() => Alert.alert('Não foi possível abrir a página', 'Tenta novamente mais tarde.'))}>Ver produto na origem</Button>}

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
                  width={Math.max(windowWidth - 32, 0)}
                  height={180}
                  chartConfig={{
                    backgroundColor: colors.surface,
                    backgroundGradientFrom: colors.surface,
                    backgroundGradientTo: colors.surface,
                    decimalPlaces: 2,
                    color: (opacity = 1) => rgba(colors.primary, opacity),
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
              <Surface style={styles.chartPlaceholder} elevation={1}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text variant="bodyMedium" style={styles.placeholderText}>A procurar preços noutros supermercados...</Text>
              </Surface>
            ) : (
              <Surface style={styles.crossContainer} elevation={1}>
                {comparedStores.map((sId, index) => {
                  const brandData = getSupermarket(sId);
                  const match = crossPrices[sId];
                  const isCurrent = match?.id === product.id;

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
                            {match?.scopeLabel && <Text variant="labelSmall" style={styles.crossProductName}>{match.scopeLabel}</Text>}
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
                      {index < comparedStores.length - 1 && <Divider />}
                    </View>
                  );
                })}
                {comparedStores.length === 0 && <Text variant="bodyMedium" style={styles.sourceInfo}>Não há preços atuais sem cartão para comparar no catálogo guardado.</Text>}
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
  sourceInfo: {
    color: colors.textMuted,
    paddingVertical: 12,
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
  imageSection: {
    alignItems: 'center',
    marginTop: 16,
  },
  detailImageWrap: {
    borderRadius: 18,
    borderWidth: 3,
    overflow: 'hidden',
  },
  unitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  unitColLeft: {
    flex: 1,
    marginLeft: 10,
  },
  unitColRight: {
    alignItems: 'flex-end',
  },
  unitLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  unitValue: {
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginTop: 2,
  },
  informationCard: {
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  informationSection: {
    marginTop: 10,
  },
  informationLabel: {
    color: colors.textPrimary,
    marginBottom: 4,
  },
  informationText: {
    color: colors.textSecondary,
    marginBottom: 4,
  },
  nutritionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  nutritionLabel: {
    color: colors.textSecondary,
    flex: 1,
    marginRight: 12,
  },
  nutritionValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
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
    fontSize: 12,
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
    fontSize: 13,
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
    fontSize: 13,
    marginTop: 2,
  },
  crossPrice: {
    fontWeight: 'bold',
    flex: 0.25,
    textAlign: 'right',
  },
});

export default ProductHistoryModal;
