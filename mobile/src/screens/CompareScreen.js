import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, SectionList, Share, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, IconButton, Button, Chip, Surface, Divider, Badge, ActivityIndicator, Card } from 'react-native-paper';
import { Q } from '@nozbe/watermelondb';
import withObservables from '@nozbe/with-observables';
import { database } from '../model';
import { findLocalFuzzyMatch } from '../utils/fuzzyMatch';
import ProductHistoryModal from '../components/ProductHistoryModal';
import { SUPERMARKET_BRANDS, getSupermarket, formatPrice } from '../components/ProductCard';
import { colors } from '../theme';

// Comparador de preços: fuzzy-match local entre supermercados e custo total
// de cada um, mostrando qual é o mais barato para a lista atual.
const ComparisonDetails = ({ shoppingList, items, favoriteIds, onToggleFavorite }) => {
  const [comparisonData, setComparisonData] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selectedProductForHistory, setSelectedProductForHistory] = useState(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const performLocalFuzzyMatch = async () => {
      if (!items || items.length === 0) {
        setComparisonData([]);
        return;
      }

      setLoading(true);
      try {
        // Fetch de todos os produtos alvo em paralelo (I/O async independente).
        const products = await Promise.all(
          items.map((item) => item.product.fetch())
        );
        const resolvedItems = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const product = products[i];
          if (!product) continue;

          // Lookups por supermercado em paralelo (antes eram sequenciais).
          const supermarkets = Object.keys(SUPERMARKET_BRANDS);
          const entries = await Promise.all(
            supermarkets.map(async (sId) => {
              if (sId === product.supermarketId) {
                return [
                  sId,
                  {
                    available: true,
                    price: parseFloat(product.price),
                    name: product.name,
                    id: product.id,
                    imageUrl: product.imageUrl,
                  },
                ];
              }
              const match = await findLocalFuzzyMatch(database, product, sId);
              if (match) {
                return [
                  sId,
                  {
                    available: true,
                    price: parseFloat(match.price),
                    name: match.name,
                    id: match.id,
                    imageUrl: match.imageUrl,
                  },
                ];
              }
              return [
                sId,
                {
                  available: false,
                  price: 0,
                  name: 'Indisponível',
                  id: null,
                  imageUrl: null,
                },
              ];
            })
          );

          const matches = {};
          for (const [sId, value] of entries) {
            matches[sId] = value;
          }

          resolvedItems.push({
            itemId: item.id,
            quantity: item.quantity,
            productName: product.name,
            productBrand: product.brand,
            productImage: product.imageUrl,
            productSupermarketId: product.supermarketId,
            matches,
          });
        }

        if (isMounted) {
          setComparisonData(resolvedItems);
        }
      } catch (e) {
        console.error("[Fuzzy Match Sync Error]:", e);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    performLocalFuzzyMatch();

    return () => {
      isMounted = false;
    };
  }, [items]);

  const { totals, cheapestId } = useMemo(() => {
    const calculatedTotals = Object.entries(SUPERMARKET_BRANDS).map(([sId, brandInfo]) => {
      let total = 0;
      let unavailableCount = 0;

      for (const item of comparisonData) {
        const match = item.matches[sId];
        if (match && match.available) {
          total += match.price * item.quantity;
        } else {
          unavailableCount += 1;
        }
      }

      return {
        supermarketId: sId,
        name: brandInfo.name,
        color: brandInfo.color,
        total,
        unavailableCount,
      };
    });

    // Só um supermercado com TODOS os artigos disponíveis pode ser o mais barato.
    // (Não comparar com um preço "baixo" artificial causado por artigos em falta.)
    const completeTotals = calculatedTotals.filter(
      t => t.total > 0 && t.unavailableCount === 0
    );

    let bestId = null;
    let minVal = Infinity;

    for (const t of completeTotals) {
      if (t.total < minVal) {
        minVal = t.total;
        bestId = t.supermarketId;
      }
    }

    return { totals: calculatedTotals, cheapestId: bestId };
  }, [comparisonData]);

  const sections = useMemo(() => {
    return totals.map(t => {
      const data = comparisonData.map(item => {
        const match = item.matches[t.supermarketId];
        return {
          key: `${t.supermarketId}-${item.itemId}`,
          supermarketId: t.supermarketId,
          originalName: item.productName,
          quantity: item.quantity,
          available: match ? match.available : false,
          price: match ? match.price : 0,
          subtotal: match ? match.price * item.quantity : 0,
          productId: match && match.available ? match.id : null,
          imageUrl: (match && match.imageUrl) || item.productImage,
        };
      });

      return {
        supermarketId: t.supermarketId,
        title: t.name,
        color: t.color,
        total: t.total,
        unavailableCount: t.unavailableCount,
        data,
      };
    });
  }, [comparisonData, totals]);

  const openHistory = async (item) => {
    if (!item.available || !item.productId) return;
    try {
      const prod = await database.collections.get('products').find(item.productId);
      if (prod) {
        setSelectedProductForHistory(prod);
        setIsHistoryVisible(true);
      }
    } catch (e) {
      console.error("[CompareScreen fetch product for history error]:", e);
    }
  };

  const handleShareBasket = async () => {    if (!comparisonData || comparisonData.length === 0) {
      alert("Adiciona produtos ao cabaz antes de partilhar.");
      return;
    }

    const cheapestBrand = SUPERMARKET_BRANDS[cheapestId];
    const cheapestTotal = totals.find(t => t.supermarketId === cheapestId)?.total || 0;

    if (!cheapestId) {
      await Share.share({
        message: `🛒 O meu cabaz PriceScoutPT ainda não tem um supermercado completo mais barato — falta algum artigo.\n\n📱 Compara preços e poupa em Portugal com o PriceScoutPT!`,
        title: 'O meu cabaz PriceScoutPT',
      });
      return;
    }

    let shareText = `🛒 O meu cabaz PriceScoutPT custa ${cheapestTotal.toFixed(2)}€ no ${cheapestBrand?.name || 'Supermercado Mais Barato'}! 🏆\n\n`;
    shareText += `📝 Lista de Compras:\n`;

    for (const item of comparisonData) {
      const match = item.matches[cheapestId];
      const priceText = match && match.available ? `${(match.price * item.quantity).toFixed(2)}€` : 'Indisponível';
      shareText += `• ${item.quantity}x ${item.productName} (${priceText})\n`;
    }

    shareText += `\n📱 Compara preços e poupa em Portugal com o PriceScoutPT!`;

    try {
      await Share.share({
        message: shareText,
        title: 'O meu cabaz PriceScoutPT',
      });
    } catch (error) {
      console.error("[CompareScreen Share Error]:", error);
    }
  };

  if (items.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <IconButton icon="scale-balance" size={60} iconColor={colors.borderStrong} />
        <Text variant="titleLarge" style={styles.emptyText}>Nada para comparar</Text>
        <Text variant="bodyMedium" style={styles.emptySubtext}>
          Adiciona produtos ao teu cabaz e vê aqui qual é o supermercado mais barato para a tua lista.
        </Text>
      </View>
    );
  }

  if (loading && comparisonData.length === 0) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="bodyMedium" style={styles.loaderText}>A analisar e a comparar preços locais...</Text>
      </View>
    );
  }

  return (
    <View style={styles.detailsContainer}>
      <View>
        <View style={styles.sectionTitleRow}>
          <Text variant="titleMedium" style={styles.sectionTitle} accessibilityRole="header">Custo Total por Supermercado</Text>
          <Button
            icon="share-variant"
            mode="text"
            compact={true}
            textColor={colors.primary}
            style={styles.shareButton}
            onPress={handleShareBasket}
            accessibilityLabel="Partilhar comparação de preços"
          >
            Partilhar
          </Button>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.summaryScroll}
        >
          {totals.map((t) => {
            const isCheapest = t.supermarketId === cheapestId;
            return (
              <Card
                key={t.supermarketId}
                style={[
                  styles.summaryCard,
                  isCheapest ? [styles.cheapestCard, { borderColor: colors.success }] : null
                ]}
                mode="outlined"
              >
                <Card.Content style={styles.summaryCardContent}>
                  <View style={styles.summaryHeaderRow}>
                    <Text variant="titleMedium" style={[styles.supermarketLabel, { color: t.color }]}>
                      {t.name}
                    </Text>
                    {isCheapest && <IconButton icon="trophy" size={20} iconColor={colors.gold} style={styles.trophyIcon} />}
                  </View>
                  <Divider style={styles.cardDivider} />
                  <Text variant="headlineMedium" style={styles.supermarketTotalText}>
                    {t.total > 0 ? `${t.total.toFixed(2)} €` : 'N/A'}
                  </Text>
                  {t.unavailableCount > 0 ? (
                    <Badge style={styles.unavailableBadge}>
                      {t.unavailableCount} item(ns) indisponível
                    </Badge>
                  ) : (
                    <Badge style={[styles.unavailableBadge, { backgroundColor: colors.successContainer, color: colors.textSecondary }]}>
                      Carrinho Completo
                    </Badge>
                  )}
                </Card.Content>
              </Card>
            );
          })}
        </ScrollView>
        <Text variant="bodySmall" style={styles.nationalNote}>
          Preços de referência nacional (catálogo online) — nas lojas físicas podem variar por região.
        </Text>
      </View>

      <Text variant="titleMedium" style={[styles.sectionTitle, { marginTop: 12 }]} accessibilityRole="header">Detalhes do Cabaz</Text>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderSectionHeader={({ section: { title, color, total, unavailableCount } }) => (
          <Surface style={[styles.sectionHeader, { borderLeftColor: color }]} elevation={1}>
            <Text variant="titleMedium" style={[styles.sectionHeaderTitle, { color }]} accessibilityRole="header">{title}</Text>
            <View style={styles.sectionHeaderRight}>
              <Text variant="titleMedium" style={styles.sectionHeaderTotal}>
                Total: {total > 0 ? `${total.toFixed(2)} €` : '—'}
              </Text>
              {unavailableCount > 0 && (
                <Badge style={styles.sectionBadge}>{unavailableCount} em falta</Badge>
              )}
            </View>
          </Surface>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.itemRow, item.available && pressed && styles.itemRowPressed]}
            disabled={!item.available}
            onPress={() => openHistory(item)}
            accessibilityRole="button"
            accessibilityLabel={item.available ? `Abrir detalhes de ${item.originalName}` : `${item.originalName}, indisponível`}
            accessibilityHint={item.available ? 'Abre o histórico de preços do produto' : undefined}
          >
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.itemThumb} resizeMode="cover" accessible={false} importantForAccessibility="no-hide-descendants" />
            ) : (
              <View style={[styles.itemThumb, styles.itemThumbFallback, { backgroundColor: getSupermarket(item.supermarketId).color }]} accessible={false} importantForAccessibility="no-hide-descendants" />
            )}
            <View style={styles.itemLeft}>
              <View style={styles.itemNameRow}>
                <Text variant="bodyLarge" style={styles.itemProductName} numberOfLines={1}>
                  {item.originalName}
                </Text>
                {item.available && item.productId && (
                  <IconButton
                    icon="information-outline"
                    size={16}
                    iconColor={colors.primary}
                    style={styles.infoIcon}
                    accessibilityLabel={`Histórico de preços de ${item.originalName}`}
                    hitSlop={8}
                    onPress={() => openHistory(item)}
                  />
                )}
              </View>
              <Text variant="bodySmall" style={styles.itemQty}>Qtd: {item.quantity}</Text>
            </View>
            <View style={styles.itemRight}>
              {item.available ? (
                <>
                  <Text variant="bodyMedium" style={styles.itemPrice}>
                    {item.price.toFixed(2)} €
                  </Text>
                  <Text variant="titleSmall" style={styles.itemSubtotal}>
                    {(item.subtotal).toFixed(2)} €
                  </Text>
                </>
              ) : (
                <Text variant="bodyMedium" style={styles.itemUnavailable}>Indisponível</Text>
              )}
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <Divider style={styles.rowDivider} />}
        contentContainerStyle={styles.listContent}
      />

      <ProductHistoryModal
        product={selectedProductForHistory}
        visible={isHistoryVisible}
        onDismiss={() => setIsHistoryVisible(false)}
        isFavorite={selectedProductForHistory ? favoriteIds.has(selectedProductForHistory.id) : false}
        onToggleFavorite={onToggleFavorite}
      />
    </View>
  );
};

const enhance = withObservables(['shoppingList'], ({ shoppingList }) => ({
  items: shoppingList.items.observe()
}));
const EnhancedComparisonDetails = enhance(ComparisonDetails);

const CompareScreen = ({ shoppingLists, favorites }) => {
  const [activeListId, setActiveListId] = useState('');

  const favoriteIds = useMemo(() => {
    return new Set((favorites || []).map(f => f.productId));
  }, [favorites]);

  useEffect(() => {
    if (shoppingLists && shoppingLists.length > 0 && !activeListId) {
      setActiveListId(shoppingLists[0].id);
    }
  }, [shoppingLists]);

  const activeList = useMemo(() => {
    if (!shoppingLists || shoppingLists.length === 0) return null;
    return shoppingLists.find(l => l.id === activeListId) || shoppingLists[0];
  }, [shoppingLists, activeListId]);

  const handleToggleFavorite = async (product, isFav) => {
    try {
      await database.write(async () => {
        if (isFav) {
          const existing = await database.collections.get('favorites').query(
            Q.where('product_id', product.id)
          ).fetch();
          for (const fav of existing) {
            await fav.destroyPermanently();
          }
        } else {
          await database.collections.get('favorites').create(fav => {
            fav.productId = product.id;
          });
        }
      });
    } catch (e) {
      console.error("[CompareScreen Favorite Error]:", e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.headerTitle}>Comparar Preços</Text>
      </View>

      {shoppingLists && shoppingLists.length > 0 ? (
        <View style={styles.listsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
            {shoppingLists.map((list) => (
              <Chip
                key={list.id}
                selected={list.id === (activeList ? activeList.id : '')}
                style={[styles.chip, { backgroundColor: list.id === (activeList ? activeList.id : '') ? colors.primary : colors.surfaceVariant }]}
                selectedColor={colors.surface}
                showSelectedOverlay={false}
                compact={true}
                textStyle={{ color: list.id === (activeList ? activeList.id : '') ? colors.surface : colors.textSecondary }}
                accessibilityState={{ selected: list.id === (activeList ? activeList.id : '') }}
                onPress={() => setActiveListId(list.id)}
              >
                {list.name}
              </Chip>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {activeList ? (
        <EnhancedComparisonDetails
          shoppingList={activeList}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <IconButton icon="scale-balance" size={60} iconColor={colors.borderStrong} />
          <Text variant="titleLarge" style={styles.emptyText}>Cria a tua lista de compras</Text>
          <Text variant="bodyMedium" style={styles.emptySubtext}>
            Pesquisa no catálogo e adiciona produtos para comparares os preços offline e economizares!
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  listsContainer: {
    backgroundColor: colors.surface,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chipsScroll: {
    paddingHorizontal: 16,
  },
  chip: {
    marginRight: 8,
    borderRadius: 20,
  },
  detailsContainer: {
    flex: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
    marginTop: 16,
  },
  sectionTitle: {
    fontWeight: 'bold',
    fontSize: 15,
    color: colors.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  shareButton: {
    margin: 0,
    padding: 0,
    marginTop: -8,
  },
  summaryScroll: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  nationalNote: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 2,
    marginBottom: 4,
  },
  summaryCard: {
    width: 150,
    marginHorizontal: 4,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
  },
  cheapestCard: {
    borderWidth: 2,
    backgroundColor: colors.successContainer,
  },
  summaryCardContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  supermarketLabel: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  trophyIcon: {
    margin: 0,
    padding: 0,
  },
  cardDivider: {
    marginVertical: 4,
  },
  supermarketTotalText: {
    fontWeight: 'bold',
    fontSize: 18,
    color: colors.textPrimary,
    marginVertical: 4,
  },
  unavailableBadge: {
    backgroundColor: colors.dangerContainer,
    color: colors.warning,
    fontSize: 12,
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderLeftWidth: 5,
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionHeaderTitle: {
    fontWeight: 'bold',
    fontSize: 15,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeaderTotal: {
    fontWeight: 'bold',
    fontSize: 14,
    color: colors.textSecondary,
    marginRight: 8,
  },
  sectionBadge: {
    backgroundColor: colors.danger,
    color: colors.surface,
  },
  listContent: {
    paddingBottom: 88,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  itemRowPressed: {
    backgroundColor: colors.surfaceVariant,
  },
  itemThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 10,
  },
  itemThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    backgroundColor: colors.border,
  },
  itemLeft: {
    flex: 0.65,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
  },
  itemProductName: {
    color: colors.textSecondary,
    maxWidth: '85%',
  },
  infoIcon: {
    margin: 0,
    padding: 0,
    marginLeft: 2,
  },
  itemQty: {
    color: colors.textMuted,
    marginTop: 2,
  },
  itemRight: {
    flex: 0.3,
    alignItems: 'flex-end',
  },
  itemPrice: {
    color: colors.textMuted,
    fontSize: 13,
  },
  itemSubtotal: {
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginTop: 2,
  },
  itemUnavailable: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 8,
    lineHeight: 20,
  },
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loaderText: {
    marginTop: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
});

const enhanceScreen = withObservables([], () => ({
  shoppingLists: database.collections.get('shopping_lists').query(
    Q.sortBy('created_at', Q.desc)
  ).observe(),
  favorites: database.collections.get('favorites').query().observe(),
}));
export default enhanceScreen(CompareScreen);