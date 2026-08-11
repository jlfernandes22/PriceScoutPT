import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, FlatList, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, IconButton, Chip, FAB, Surface, Divider, ActivityIndicator, Portal, Dialog, Button, TouchableRipple , useTheme } from 'react-native-paper';
import { Q } from '@nozbe/watermelondb';
import withObservables from '@nozbe/with-observables';
import { database } from '../model';
import ProductHistoryModal from '../components/ProductHistoryModal';
import { getSupermarket, formatPrice } from '../components/ProductCard';

// Cabaz simples: lista de produtos, origem (supermercado) e total.
// A comparação de preços vive no separador "Comparar".
const BasketDetails = ({ shoppingList, items, favoriteIds, onToggleFavorite }) => {
  const theme = useTheme();
  const colors = theme.colors;
  const styles = createStyles(colors);
  const [resolvedItems, setResolvedItems] = useState(null);
  const [selectedProductForHistory, setSelectedProductForHistory] = useState(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [clearDialogVisible, setClearDialogVisible] = useState(false);

  // Resolve o produto (nome/preço/supermercado) de cada item de forma reativa ao items.
  useEffect(() => {
    let isMounted = true;

    const resolveProducts = async () => {
      if (!items || items.length === 0) {
        setResolvedItems([]);
        return;
      }
      const resolved = [];
      for (const item of items) {
        let product = null;
        try {
          product = await item.product.fetch();
        } catch (e) {
          // produto já não existe/corrompido — ignora
        }
        resolved.push({ item, quantity: item.quantity, product });
      }
      if (isMounted) setResolvedItems(resolved);
    };

    resolveProducts();

    return () => {
      isMounted = false;
    };
  }, [items]);

  const validItems = useMemo(() => {
    return (resolvedItems || []).filter(r => r.product);
  }, [resolvedItems]);

  const total = useMemo(() => {
    return validItems.reduce((acc, r) => acc + (parseFloat(r.product.price) || 0) * r.quantity, 0);
  }, [validItems]);

  const updateQuantity = async (item, delta) => {
    try {
      await database.write(async () => {
        const newQty = item.quantity + delta;
        if (newQty <= 0) {
          await item.destroyPermanently();
        } else {
          await item.update((i) => { i.quantity = newQty; });
        }
      });
    } catch (e) {
      console.error("[BasketScreen Update Qty Error]:", e);
    }
  };

  const removeItem = async (item) => {
    try {
      await database.write(async () => {
        await item.destroyPermanently();
      });
    } catch (e) {
      console.error("[BasketScreen Remove Error]:", e);
    }
  };

  const handleClearList = async () => {
    setClearDialogVisible(false);
    try {
      await database.write(async () => {
        const itemsToDelete = await database.collections.get('shopping_list_items').query(
          Q.where('list_id', shoppingList.id)
        ).fetch();
        for (const item of itemsToDelete) {
          await item.destroyPermanently();
        }
      });
    } catch (e) {
      console.error("[Clear List Write Error]:", e);
    }
  };

  if (resolvedItems === null) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (validItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <IconButton icon="cart-outline" size={60} iconColor={colors.borderStrong} accessible={false} importantForAccessibility="no-hide-descendants" />
        <Text variant="titleLarge" style={styles.emptyText}>O teu Cabaz está vazio</Text>
        <Text variant="bodyMedium" style={styles.emptySubtext}>
          Pesquisa produtos no catálogo e adiciona-os para os teres sempre à mão.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.detailsContainer}>
      {/* Resumo Total */}
      <Surface style={styles.totalCard} elevation={2}>
        <View style={styles.totalCol}>
          <Text variant="labelLarge" style={styles.totalLabel}>Total do Cabaz</Text>
          <Text variant="headlineMedium" style={styles.totalText}>
            {formatPrice(total)}
          </Text>
        </View>
        <View style={styles.totalMeta}>
          <Text variant="bodyMedium" style={styles.totalMetaText}>
            {validItems.length} {validItems.length === 1 ? 'produto' : 'produtos'}
          </Text>
        </View>
      </Surface>

      <Text variant="titleMedium" style={styles.listTitle} accessibilityRole="header">A tua lista</Text>

      <FlatList
        data={validItems}
        keyExtractor={(r) => r.item.id}
        renderItem={({ item: r }) => {
          const brandInfo = getSupermarket(r.product.supermarketId);
          const subtotal = (parseFloat(r.product.price) || 0) * r.quantity;
          return (
            <TouchableRipple
              style={styles.itemRow}
              onPress={() => {
                setSelectedProductForHistory(r.product);
                setIsHistoryVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Abrir detalhes de ${r.product.name}`}
              accessibilityHint="Abre o histórico de preços do produto"
            >
              {r.product.imageUrl ? (
                <Image source={{ uri: r.product.imageUrl }} style={styles.itemThumb} resizeMode="cover" resizeMethod="resize" accessible={false} importantForAccessibility="no-hide-descendants" />
              ) : (
                <View style={[styles.itemThumb, styles.itemThumbFallback, { backgroundColor: brandInfo.color, alignItems: 'center', justifyContent: 'center' }]} accessible={false} importantForAccessibility="no-hide-descendants" />
              )}

              <View style={styles.itemInfo}>
                <Text variant="bodyLarge" style={styles.itemName} numberOfLines={2}>
                  {r.product.name}
                </Text>
                <View style={styles.itemBadgeRow}>
                  <View style={[styles.badgeDot, { backgroundColor: brandInfo.color }]} />
                  <Text variant="labelMedium" numberOfLines={1} style={[styles.itemSupermarket, { color: brandInfo.color }]}>
                    {brandInfo.name}
                  </Text>
                  {r.product.brand ? (
                    <Text variant="bodySmall" style={styles.itemUnit} numberOfLines={1}>
                      · {r.product.brand}
                    </Text>
                  ) : null}
                </View>
                <Text variant="bodySmall" numberOfLines={1} style={styles.itemUnitPrice}>
                  {formatPrice(r.product.price)}
                  {r.product.unit ? ` / ${r.product.unit}` : ''}
                </Text>
              </View>

              <View style={styles.itemRight}>
                <Text variant="titleSmall" style={styles.itemSubtotal}>{formatPrice(subtotal)}</Text>
                <View style={styles.qtyRow}>
                  <IconButton
                    icon="minus"
                    size={16}
                    iconColor={colors.primary}
                    style={styles.qtyBtn}
                    onPress={() => updateQuantity(r.item, -1)}
                    accessibilityLabel={`Diminuir quantidade de ${r.product.name}`}
                    accessibilityState={{ disabled: r.quantity <= 1 }}
                    disabled={r.quantity <= 1}
                    hitSlop={8}
                  />
                  <Text variant="bodyMedium" style={styles.qtyText} accessible accessibilityLabel={`Quantidade ${r.quantity}`}>{r.quantity}</Text>
                  <IconButton
                    icon="plus"
                    size={16}
                    iconColor={colors.primary}
                    style={styles.qtyBtn}
                    onPress={() => updateQuantity(r.item, 1)}
                    accessibilityLabel={`Aumentar quantidade de ${r.product.name}`}
                    hitSlop={8}
                  />
                </View>
              </View>

              <IconButton
                icon="delete-outline"
                size={18}
                iconColor={colors.textMuted}
                style={styles.removeBtn}
                onPress={() => removeItem(r.item)}
                accessibilityLabel={`Remover ${r.product.name} do cabaz`}
                hitSlop={8}
              />
            </TouchableRipple>
          );
        }}
        ItemSeparatorComponent={() => <Divider style={styles.rowDivider} />}
        contentContainerStyle={styles.listContent}
      />

      {/* Modal de Histórico de Preços */}
      <ProductHistoryModal
        product={selectedProductForHistory}
        visible={isHistoryVisible}
        onDismiss={() => setIsHistoryVisible(false)}
        isFavorite={selectedProductForHistory ? favoriteIds.has(selectedProductForHistory.id) : false}
        onToggleFavorite={onToggleFavorite}
      />

      <FAB
        icon="cart-remove"
        style={styles.fab}
        color={colors.surface}
        onPress={() => setClearDialogVisible(true)}
        label="Limpar Cabaz"
      />

      <Portal>
        <Dialog visible={clearDialogVisible} onDismiss={() => setClearDialogVisible(false)} style={{ backgroundColor: colors.surface }}>
          <Dialog.Title>Limpar Cabaz</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Tem a certeza que pretende apagar todos os produtos desta lista de compras? Esta ação é irreversível.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.textMuted} onPress={() => setClearDialogVisible(false)}>Cancelar</Button>
            <Button textColor={colors.danger} onPress={handleClearList}>Limpar Tudo</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
};

const enhance = withObservables(['shoppingList'], ({ shoppingList }) => ({
  items: shoppingList.items.observe()
}));
const EnhancedBasketDetails = enhance(BasketDetails);

const BasketScreen = ({ shoppingLists, favorites }) => {
  const theme = useTheme();
  const colors = theme.colors;
  const styles = createStyles(colors);
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
      console.error("[BasketScreen Favorite Error]:", e);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.headerTitle}>Meu Cabaz</Text>
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
        <EnhancedBasketDetails
          shoppingList={activeList}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <IconButton icon="cart-plus" size={60} iconColor={colors.borderStrong} />
          <Text variant="titleLarge" style={styles.emptyText}>Cria a tua lista de compras</Text>
          <Text variant="bodyMedium" style={styles.emptySubtext}>
            Pesquisa no catálogo e adiciona produtos à tua lista de compras.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors) => StyleSheet.create({
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
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  totalCol: {
    flex: 1,
  },
  totalLabel: {
    color: colors.textMuted,
  },
  totalText: {
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 2,
  },
  totalMeta: {
    alignItems: 'flex-end',
  },
  totalMetaText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  listTitle: {
    fontWeight: 'bold',
    fontSize: 15,
    color: colors.textSecondary,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  listContent: {
    paddingBottom: 88,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  itemThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: colors.background,
  },
  itemThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  itemBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
    flexShrink: 0,
  },
  itemSupermarket: {
    fontWeight: '700',
    flexShrink: 1,
  },
  itemUnit: {
    color: colors.textMuted,
    marginLeft: 4,
    flexShrink: 1,
  },
  itemUnitPrice: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 3,
    flexShrink: 1,
  },
  itemRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
    flexShrink: 0,
  },
  itemSubtotal: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  qtyBtn: {
    margin: 0,
    width: 26,
    height: 26,
  },
  qtyText: {
    minWidth: 24,
    textAlign: 'center',
    fontWeight: '700',
    color: colors.textPrimary,
  },
  removeBtn: {
    margin: 0,
    marginLeft: 4,
    width: 28,
    height: 28,
  },
  rowDivider: {
    backgroundColor: colors.border,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: colors.danger,
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
  },
});

const enhanceScreen = withObservables([], () => ({
  shoppingLists: database.collections.get('shopping_lists').query(
    Q.sortBy('created_at', Q.desc)
  ).observe(),
  favorites: database.collections.get('favorites').query().observe(),
}));
export default enhanceScreen(BasketScreen);