import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Text, IconButton, Icon, Divider, Badge, ActivityIndicator, Appbar , useTheme } from 'react-native-paper';
import { LineChart } from 'react-native-chart-kit';
import Animated from 'react-native-reanimated';
import axios from 'axios';
import { useLocalFuzzyMatch } from '../utils/fuzzyMatch';
import { computeUnitPrice } from '../utils/unitPrice';
import { API_BASE_URL } from '../config';
import { SUPERMARKET_BRANDS, getSupermarket, ProductImage } from '../components/ProductCard';
import { database } from '../model';
import { ShimmerClockProvider, SkeletonChart, SkeletonRows } from '../theme/loading';
import { m3FadeIn } from '../theme/motion';
import { useReduceMotion } from '../theme/motion';

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
};

const ProductHistoryScreen = ({ route, navigation }) => {
  const theme = useTheme();
  const colors = theme.colors;
  const styles = createStyles(colors);
  const reduceMotion = useReduceMotion();

  const { productId } = route.params || {};

  const [product, setProduct] = useState(null);
  const [history, setHistory] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);

  // Hook reativo para preços cruzados offline
  const { matches: crossPrices, loading: crossLoading } = useLocalFuzzyMatch(product);

  // Carrega o produto e o estado de favorito
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const prod = await database.collections.get('products').find(productId);
        if (!mounted) return;
        setProduct(prod);
        const favs = await database.collections.get('favorites').query().fetch();
        if (mounted) setIsFavorite(favs.some((f) => f.productId === productId));
      } catch (e) {
        console.error('[ProductHistoryScreen Load Error]:', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [productId]);

  useEffect(() => {
    let isMounted = true;

    if (product) {
      const fetchHistory = async () => {
        setFetching(true);
        setNetworkError(false);
        try {
          const response = await axios.get(`${API_BASE_URL}/api/products/${product.id}`, { timeout: 8000 });
          if (isMounted && response.data && response.data.price_history) {
            setHistory(response.data.price_history);
          }
        } catch (e) {
          console.error('[ProductHistoryScreen Fetch Error]:', e);
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
      setHistory([]);
      setNetworkError(false);
      setFetching(false);
    }

    return () => {
      isMounted = false;
    };
  }, [product]);

  const toggleFavorite = async () => {
    if (!product) return;
    try {
      await database.write(async () => {
        if (isFavorite) {
          const favs = await database.collections.get('favorites').query().fetch();
          for (const fav of favs) {
            if (fav.productId === product.id) {
              await fav.destroyPermanently();
            }
          }
        } else {
          await database.collections.get('favorites').create((fav) => {
            fav.productId = product.id;
          });
        }
      });
      setIsFavorite(!isFavorite);
    } catch (e) {
      console.error('[ProductHistoryScreen Favorite Error]:', e);
    }
  };

  const brandInfo = product ? getSupermarket(product.supermarketId) : { name: '', color: colors.outline };

  const unitInfo = product ? computeUnitPrice(product.price, product.unit, product.name) : null;
  const unitText = product
    ? (unitInfo ? unitInfo.parsed.totalText : (product.unit && product.unit.trim() !== '' ? product.unit : null))
    : null;
  const unitLabel = unitInfo
    ? (unitInfo.label === '€/kg' ? 'Preço por kg' : unitInfo.label === '€/l' ? 'Preço por litro' : 'Preço por unidade')
    : 'Preço por unidade';

  const stats = useMemo(() => {
    if (!product) return { min: 0, max: 0, current: 0 };
    const currentPrice = parseFloat(product.price);

    if (!history || history.length === 0) {
      return { min: currentPrice, max: currentPrice, current: currentPrice };
    }

    const prices = history.map((item) => parseFloat(item.price));
    return {
      min: Math.min(...prices, currentPrice),
      max: Math.max(...prices, currentPrice),
      current: currentPrice,
    };
  }, [history, product]);

  const chartData = useMemo(() => {
    if (!history || history.length < 2) return null;

    const sorted = [...history].reverse();
    const prices = sorted.map((item) => parseFloat(item.price));

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
          color: (opacity = 1) => `rgba(${hexToRgb(colors.primary)}, ${opacity})`,
          strokeWidth: 3,
        },
      ],
    };
  }, [history, colors.primary]);

  if (!product) {
    return (
      <SafeAreaView style={styles.container}>
        <Appbar.Header style={styles.appbar}>
          <Appbar.BackAction onPress={() => navigation.goBack()} />
          <Appbar.Content title="Histórico de Preços" />
        </Appbar.Header>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.BackAction onPress={() => navigation.goBack()} accessibilityLabel="Voltar" />
        <Appbar.Content title={product.name} titleStyle={styles.appbarTitle} numberOfLines={1} />
        <Appbar.Action
          icon={isFavorite ? 'heart' : 'heart-outline'}
          iconColor={isFavorite ? colors.error : colors.onSurfaceVariant}
          onPress={toggleFavorite}
          accessibilityLabel={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          accessibilityState={{ selected: isFavorite }}
        />
      </Appbar.Header>

      <ShimmerClockProvider>
      <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
        {/* 0. Imagem do Produto (hero com shared transition) */}
        <View style={styles.imageSection} accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={[styles.detailImageWrap, { borderColor: brandInfo.color }]}>
            {reduceMotion ? (
              <ProductImage url={product.imageUrl} color={brandInfo.color} size={170} />
            ) : (
              <Animated.Image
                sharedTransitionTag={`product-image-${product.id}`}
                source={{ uri: product.imageUrl }}
                style={{ width: 170, height: 170, borderRadius: 15 }}
                resizeMode="cover"
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              />
            )}
          </View>
        </View>

        {/* 0.5 Peso / Volume e Preço por Unidade */}
        {unitText && (
          <Surface style={styles.unitCard} elevation={1} entering={m3FadeIn}>
            <Icon icon="scale-balance" size={22} color={brandInfo.color} />
            <View style={styles.unitColLeft}>
              <Text variant="bodySmall" style={styles.unitLabel}>Peso / Volume</Text>
              <Text variant="titleSmall" style={styles.unitValue}>{unitText}</Text>
            </View>
            <View style={styles.unitColRight}>
              <Text variant="bodySmall" style={styles.unitLabel}>{unitLabel}</Text>
              <Text variant="titleSmall" style={styles.unitValue}>
                {unitInfo ? `${unitInfo.per.toFixed(2).replace('.', ',')} ${unitInfo.label}` : '—'}
              </Text>
            </View>
          </Surface>
        )}

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
            <Text variant="titleLarge" style={styles.statValue}>
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
          <SkeletonChart />
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
                backgroundColor: colors.surface,
                backgroundGradientFrom: colors.surface,
                backgroundGradientTo: colors.surface,
                decimalPlaces: 2,
                color: (opacity = 1) => `rgba(${hexToRgb(colors.primary)}, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(${hexToRgb(colors.onSurfaceVariant)}, ${opacity})`,
                propsForDots: {
                  r: '4',
                  strokeWidth: '2',
                  stroke: colors.primary,
                },
              }}
              bezier
              style={styles.chart}
            />
          </Surface>
        ) : (
          <Surface style={[styles.chartPlaceholder, { borderLeftWidth: 4, borderLeftColor: colors.success }]} elevation={1}>
            <IconButton icon="check-circle-outline" size={32} iconColor={colors.success} style={{ margin: 0 }} />
            <Text variant="bodyMedium" style={{ fontWeight: 'bold', color: colors.onSurfaceVariant }}>Preço Estável nos últimos 30 dias</Text>
            <Text variant="bodySmall" style={{ color: colors.outline, marginTop: 4 }}>Não foi registada nenhuma oscilação neste período.</Text>
          </Surface>
        )}

        {/* 3. Comparação Cruzada (Offline) */}
        <Text variant="titleSmall" style={styles.sectionTitle} accessibilityRole="header">Preços Atuais na Concorrência (Offline)</Text>
        {crossLoading ? (
          <SkeletonRows count={5} thumb={28} />
        ) : (
          <Surface style={styles.crossContainer} elevation={1} entering={m3FadeIn}>
            {Object.entries(SUPERMARKET_BRANDS).map(([sId, brandData], index) => {
              const match = crossPrices[sId];
              const isCurrent = sId === product.supermarketId;

              return (
                <View key={sId}>
                  <View style={styles.crossRow}>
                    <View style={styles.crossLeft}>
                      <Badge
                        style={[styles.miniBadge, { backgroundColor: brandData.color, color: colors.onBrand }]}
                        accessible={false}
                        importantForAccessibility="no-hide-descendants"
                      >
                        {brandData.name.charAt(0)}
                      </Badge>
                      <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text variant="bodyMedium" style={styles.crossSupermarketName}>
                          {brandData.name} {isCurrent && <Text style={{ color: colors.outline, fontSize: 12 }}>(Origem)</Text>}
                        </Text>
                        <Text variant="bodySmall" style={styles.crossProductName} numberOfLines={1}>
                          {match && match.available ? match.name : 'Não disponível'}
                        </Text>
                      </View>
                    </View>
                    <Text
                      variant="titleMedium"
                      style={styles.crossPrice}
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
      </ShimmerClockProvider>
    </SafeAreaView>
  );
};

// Converte hex token → "r,g,b" para o chart-kit (rgba strings)
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const int = parseInt(h, 16);
  return `${(int >> 16) & 255},${(int >> 8) & 255},${int & 255}`;
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appbar: {
    backgroundColor: colors.surface,
  },
  appbarTitle: {
    fontWeight: 'bold',
  },
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: colors.onSurfaceVariant,
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
    color: colors.outline,
    fontSize: 12,
  },
  unitValue: {
    fontWeight: 'bold',
    color: colors.onSurfaceVariant,
    marginTop: 2,
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
    color: colors.outline,
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
  errorText: {
    fontWeight: 'bold',
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  errorSubtext: {
    color: colors.outline,
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
    fontSize: 13,
    fontWeight: 'bold',
  },
  crossSupermarketName: {
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  crossProductName: {
    color: colors.outline,
    fontSize: 13,
    marginTop: 2,
  },
  crossPrice: {
    fontWeight: 'bold',
    flex: 0.25,
    textAlign: 'right',
  },
});

export default ProductHistoryScreen;
