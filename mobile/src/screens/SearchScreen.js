import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { View, StyleSheet, FlatList, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Searchbar, Text, IconButton, Portal, Dialog, Button, TextInput, RadioButton, Surface, Chip, Icon, Snackbar , useTheme } from 'react-native-paper';
import { Q } from '@nozbe/watermelondb';
import withObservables from '@nozbe/with-observables';
import { useNavigation } from '@react-navigation/native';
import { database } from '../model';
import { syncDatabase } from '../services/sync';
import SettingsModal from '../components/SettingsModal';
import ProductCard, { SUPERMARKET_BRANDS, getSupermarket } from '../components/ProductCard';
import { M3LoadingIndicator, M3LoadingOverlay } from '../theme/loading';
import { useSyncState } from '../services/syncState';

const ALL_SUPERMARKETS = 'all';

const ProductList = memo(function ProductList({
  products,
  categories,
  selectedSupermarket,
  selectedCategoryId,
  onSupermarketChange,
  onCategoryChange,
  refreshing,
  onRefresh,
  onAddToBasket,
  onViewHistory,
  favoriteIds,
  onToggleFavorite,
  onLoadMore,
}) {
  const [showAllCategories, setShowAllCategories] = useState(false);

  const theme = useTheme();
  const colors = theme.colors;
  const styles = createStyles(colors);

  const visibleCategories = useMemo(() => {
    // As categorias são canónicas (globais) — aplicam-se a todos os supermercados.
    const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    return showAllCategories ? sorted : sorted.slice(0, 8);
  }, [categories, showAllCategories]);

  const renderItem = useCallback(
    ({ item }) => (
      <ProductCard
        product={item}
        isFavorite={favoriteIds.has(item.id)}
        onToggleFavorite={onToggleFavorite}
        onAddToBasket={onAddToBasket}
        onPress={() => onViewHistory(item)}
      />
    ),
    [favoriteIds, onToggleFavorite, onAddToBasket, onViewHistory]
  );

  return (
    <View style={styles.flex}>
      {/* Filtro por supermercado */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          <Chip
            selected={selectedSupermarket === ALL_SUPERMARKETS}
            onPress={() => onSupermarketChange(ALL_SUPERMARKETS)}
            style={[styles.filterChip, { backgroundColor: selectedSupermarket === ALL_SUPERMARKETS ? colors.textPrimary : colors.surfaceVariant }]}
            selectedColor={colors.surface}
            showSelectedOverlay={false}
            textStyle={{ color: selectedSupermarket === ALL_SUPERMARKETS ? colors.surface : colors.textSecondary, fontSize: 13 }}
            accessibilityState={{ selected: selectedSupermarket === ALL_SUPERMARKETS }}
          >
            Todos
          </Chip>
          {Object.entries(SUPERMARKET_BRANDS).map(([id, info]) => (
            <Chip
              key={id}
              selected={selectedSupermarket === id}
              onPress={() => onSupermarketChange(id)}
              style={[styles.filterChip, { backgroundColor: selectedSupermarket === id ? info.color : colors.surfaceVariant }]}
              selectedColor={colors.surface}
              showSelectedOverlay={false}
              textStyle={{ color: selectedSupermarket === id ? colors.surface : colors.textSecondary, fontSize: 13 }}
              accessibilityState={{ selected: selectedSupermarket === id }}
            >
              {info.name}
            </Chip>
          ))}
        </ScrollView>
      </View>

      {/* Filtro por categoria */}
      {visibleCategories.length > 0 && (
        <View style={styles.categoryBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <Chip
              icon={({ size }) => <Icon source="view-grid-outline" size={size} color={!selectedCategoryId ? colors.surface : colors.primary} />}
              selected={!selectedCategoryId}
              onPress={() => onCategoryChange(null)}
              style={[styles.filterChip, { backgroundColor: !selectedCategoryId ? colors.primary : colors.surfaceVariant }]}
              compact
              selectedColor={colors.surface}
              showSelectedOverlay={false}
              textStyle={{ fontSize: 12, color: !selectedCategoryId ? colors.surface : colors.textMuted }}
              accessibilityState={{ selected: !selectedCategoryId }}
            >
              Tudo
            </Chip>
            {visibleCategories.map((cat) => (
              <Chip
                key={cat.id}
                selected={selectedCategoryId === cat.id}
                onPress={() => onCategoryChange(cat.id)}
                style={[styles.filterChip, { backgroundColor: selectedCategoryId === cat.id ? colors.primary : colors.surfaceVariant }]}
                compact
                selectedColor={colors.surface}
                showSelectedOverlay={false}
                textStyle={{ fontSize: 12, color: selectedCategoryId === cat.id ? colors.surface : colors.textMuted }}
                accessibilityState={{ selected: selectedCategoryId === cat.id }}
              >
                {cat.name}
              </Chip>
            ))}
            {categories.length > 8 && (
              <Chip
                icon={showAllCategories ? 'chevron-up' : 'chevron-down'}
                onPress={() => setShowAllCategories((v) => !v)}
                style={[styles.filterChip, { backgroundColor: colors.surfaceVariant }]}
                compact
                textStyle={{ fontSize: 12, color: colors.textMuted }}
                accessibilityState={{ selected: showAllCategories }}
              >
                {showAllCategories ? 'Menos' : 'Mais'}
              </Chip>
            )}
          </ScrollView>
        </View>
      )}

      <FlatList
        data={products}
        keyExtractor={(item, index) => item.id ? `${item.id}-${index}` : index.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
        refreshing={refreshing}
        onRefresh={onRefresh}
        keyboardShouldPersistTaps="handled"
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={10}
        maxToRenderPerBatch={12}
        windowSize={7}
        updateCellsBatchingPeriod={80}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <IconButton icon="magnify-minus" size={60} iconColor={colors.borderStrong} />
            <Text variant="titleMedium" style={styles.emptyText}>
              Nenhum produto encontrado.
            </Text>
            <Text variant="bodyMedium" style={styles.emptySubtext}>
              Pesquisa por outro termo ou faz Swipe Down para atualizar o catálogo.
            </Text>
          </View>
        )}
      />
    </View>
  );
});

const PAGE_SIZE = 60;
const MAX_LIST_RESULTS = 60000;

const enhanceList = withObservables(
  ['searchTerm', 'selectedSupermarket', 'selectedCategoryId', 'limit'],
  ({ searchTerm, selectedSupermarket, selectedCategoryId, limit }) => {
    const conditions = [
      Q.where('in_stock', true),
      Q.where('deleted', false),
    ];

    if (searchTerm && searchTerm.trim().length > 0) {
      conditions.push(Q.where('name', Q.like(`%${Q.sanitizeLikeString(searchTerm.trim())}%`)));
    }
    if (selectedSupermarket && selectedSupermarket !== ALL_SUPERMARKETS) {
      conditions.push(Q.where('supermarket_id', selectedSupermarket));
    }
    if (selectedCategoryId) {
      conditions.push(Q.where('category_id', selectedCategoryId));
    }
    conditions.push(Q.take(Math.min(limit, MAX_LIST_RESULTS)));

    return {
      products: database.collections.get('products').query(...conditions).observe(),
    };
  }
);
const EnhancedProductList = enhanceList(ProductList);

const SearchScreen = ({ shoppingLists, favorites, categories }) => {
  const theme = useTheme();
  const colors = theme.colors;
  const styles = createStyles(colors);
  const { isSyncing, setSyncState } = useSyncState();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedSupermarket, setSelectedSupermarket] = useState(ALL_SUPERMARKETS);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [syncTrigger, setSyncTrigger] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [searchTimer, setSearchTimer] = useState(null);

  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedListId, setSelectedListId] = useState('');
  const [isCreatingNewList, setIsCreatingNewList] = useState(false);
  const [newListName, setNewListName] = useState('');

  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const navigation = useNavigation();

  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const resetPagination = useCallback(() => setVisibleLimit(PAGE_SIZE), []);
  const handleLoadMore = useCallback(() => {
    setVisibleLimit((prev) => Math.min(prev + PAGE_SIZE, MAX_LIST_RESULTS));
  }, []);

  const favoriteIds = useMemo(() => {
    return new Set((favorites || []).map(f => f.productId));
  }, [favorites]);

  useEffect(() => {
    if (shoppingLists && shoppingLists.length > 0) {
      if (!selectedListId) {
        setSelectedListId(shoppingLists[0].id);
      }
    } else {
      setIsCreatingNewList(true);
    }
  }, [shoppingLists]);

  const onChangeSearch = (query) => {
    setSearchQuery(query);
    resetPagination();
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => setDebouncedQuery(query), 300));
  };

  const handleSync = useCallback(async (trigger = 'button') => {
    if (isSyncing) return;
    Keyboard.dismiss();
    setSyncTrigger(trigger);
    setSyncState(true);
    try {
      await syncDatabase(database);
      setSyncMessage('Catálogo atualizado.');
    } catch (e) {
      console.error("[Sync Screen Error]:", e);
      setSyncMessage('Não foi possível atualizar. Verifica a ligação à internet.');
    } finally {
      setSyncTrigger(null);
      setSyncState(false);
    }
  }, [isSyncing, setSyncState]);

  const openAddToBasketDialog = useCallback((product) => {
    setSelectedProduct(product);
    setQuantity(1);
    if (shoppingLists && shoppingLists.length > 0) {
      setIsCreatingNewList(false);
      setSelectedListId(shoppingLists[0].id);
    } else {
      setIsCreatingNewList(true);
      setSelectedListId('new');
    }
    setIsDialogVisible(true);
  }, [shoppingLists]);

  const handleSaveToBasket = async () => {
    if (!selectedProduct) return;
    try {
      await database.write(async () => {
        let targetList;
        if (isCreatingNewList || selectedListId === 'new') {
          const name = newListName.trim() || 'Lista Principal';
          targetList = await database.collections.get('shopping_lists').create((list) => {
            list.name = name;
          });
          setSelectedListId(targetList.id);
        } else {
          targetList = await database.collections.get('shopping_lists').find(selectedListId);
        }

        const existingItems = await database.collections.get('shopping_list_items').query(
          Q.where('list_id', targetList.id),
          Q.where('product_id', selectedProduct.id)
        ).fetch();

        if (existingItems.length > 0) {
          await existingItems[0].update((item) => {
            item.quantity += quantity;
          });
        } else {
          await database.collections.get('shopping_list_items').create((item) => {
            item.listId = targetList.id;
            item.productId = selectedProduct.id;
            item.quantity = quantity;
          });
        }
      });
      setIsDialogVisible(false);
      setNewListName('');
    } catch (e) {
      console.error("[SearchScreen Add Error]:", e);
    }
  };

  const handleToggleFavorite = useCallback(async (product, isFav) => {
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
      console.error("[SearchScreen Favorite Error]:", e);
    }
  }, []);

  const handleViewHistory = useCallback((product) => {
    navigation.navigate('ProductHistory', { productId: product.id });
  }, [navigation]);

  const handleChangeSupermarket = useCallback((id) => {
    setSelectedSupermarket(id);
    setSelectedCategoryId(null);
    resetPagination();
  }, []);

  const handleChangeCategory = useCallback((id) => {
    setSelectedCategoryId(id);
    resetPagination();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text variant="headlineSmall" style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            PriceScoutPT
          </Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon="sync"
            mode="contained-tonal"
            size={22}
            loading={isSyncing && syncTrigger === 'button'}
            disabled={isSyncing}
            onPress={() => handleSync('button')}
            style={styles.headerIcon}
            accessibilityLabel="Sincronizar catálogo"
            accessibilityState={{ busy: isSyncing }}
            accessibilityHint="Atualiza a lista de produtos a partir do servidor"
          />
          <IconButton
            icon="cog-outline"
            mode="contained-tonal"
            size={22}
            onPress={() => setIsSettingsVisible(true)}
            style={styles.headerIcon}
            accessibilityLabel="Definições"
            accessibilityHint="Abre o painel de controlo e manutenção de dados"
          />
        </View>
      </View>

      <Searchbar
        placeholder="Pesquisar produtos (ex: arroz, leite...)"
        onChangeText={onChangeSearch}
        value={searchQuery}
        style={styles.searchbar}
        inputStyle={styles.searchbarInput}
        accessibilityLabel="Pesquisar produtos"
        accessibilityHint="Escreve o nome de um produto para filtrar a lista"
      />

      {isSyncing ? (
        <View style={styles.syncLoadingContainer} accessibilityRole="progressbar" accessibilityLabel="A atualizar o catálogo">
          <M3LoadingOverlay size={64} label="A atualizar o catálogo" />
          <Text variant="bodyLarge" style={styles.syncLoadingText}>
            A atualizar o catálogo…
          </Text>
          <Text variant="bodySmall" style={styles.syncLoadingHint}>
            Filtros indisponíveis durante a sincronização
          </Text>
        </View>
      ) : (
        <EnhancedProductList
          searchTerm={debouncedQuery}
          categories={categories || []}
          selectedSupermarket={selectedSupermarket}
          selectedCategoryId={selectedCategoryId}
          onSupermarketChange={handleChangeSupermarket}
          onCategoryChange={handleChangeCategory}
          refreshing={false}
          onRefresh={() => handleSync('pull')}
          onAddToBasket={openAddToBasketDialog}
          onViewHistory={handleViewHistory}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
          limit={visibleLimit}
          onLoadMore={handleLoadMore}
        />
      )}

      <SettingsModal
        visible={isSettingsVisible}
        onDismiss={() => setIsSettingsVisible(false)}
      />

      <Snackbar
        visible={syncMessage !== ''}
        onDismiss={() => setSyncMessage('')}
        duration={3000}
        action={{ label: 'OK', onPress: () => setSyncMessage('') }}
        accessibilityLiveRegion="polite"
      >
        {syncMessage}
      </Snackbar>

      <Portal>
        <Dialog visible={isDialogVisible} onDismiss={() => setIsDialogVisible(false)} style={styles.dialog}>
          <Dialog.Title style={styles.dialogTitle}>Adicionar ao Meu Cabaz</Dialog.Title>
          <Dialog.Content>
            {selectedProduct && (
              <View style={styles.dialogProductInfo}>
                <Text variant="titleMedium" style={styles.dialogProductName}>{selectedProduct.name}</Text>
                <Text variant="bodyMedium" style={{ color: getSupermarket(selectedProduct.supermarketId).color, fontWeight: 'bold' }}>
                  Preço: {parseFloat(selectedProduct.price).toFixed(2)} € em {getSupermarket(selectedProduct.supermarketId).name}
                </Text>
              </View>
            )}

            <Text variant="bodyLarge" style={styles.sectionLabel}>Quantidade:</Text>
            <View style={styles.quantityContainer}>
              <IconButton
                icon="minus-circle-outline"
                size={32}
                iconColor={colors.danger}
                disabled={quantity <= 1}
                onPress={() => setQuantity(prev => Math.max(1, prev - 1))}
                accessibilityLabel="Diminuir quantidade"
                accessibilityState={{ disabled: quantity <= 1 }}
              />
              <Surface style={styles.quantityDisplay} elevation={1} accessible accessibilityLabel={`Quantidade ${quantity}`}>
                <Text variant="headlineSmall" style={styles.quantityText}>{quantity}</Text>
              </Surface>
              <IconButton
                icon="plus-circle-outline"
                size={32}
                iconColor={colors.success}
                onPress={() => setQuantity(prev => prev + 1)}
                accessibilityLabel="Aumentar quantidade"
              />
            </View>

            <Text variant="bodyLarge" style={styles.sectionLabel}>Escolher Lista:</Text>
            {shoppingLists && shoppingLists.length > 0 ? (
              <View style={styles.listsContainer}>
                <RadioButton.Group
                  onValueChange={(value) => {
                    setSelectedListId(value);
                    setIsCreatingNewList(value === 'new');
                  }}
                  value={selectedListId}
                >
                  <ScrollView style={styles.listsScroll} nestedScrollEnabled={true}>
                    {shoppingLists.map((list) => (
                      <View key={list.id} style={styles.radioRow}>
                        <RadioButton value={list.id} color={colors.primary} />
                        <Text variant="bodyMedium" style={styles.radioLabel}>{list.name}</Text>
                      </View>
                    ))}
                    <View style={styles.radioRow}>
                      <RadioButton value="new" color={colors.primary} />
                      <Text variant="bodyMedium" style={styles.radioLabel}>[ Criar Nova Lista ]</Text>
                    </View>
                  </ScrollView>
                </RadioButton.Group>
              </View>
            ) : null}

            {(isCreatingNewList || !shoppingLists || shoppingLists.length === 0) && (
              <TextInput
                label="Nome da Nova Lista"
                value={newListName}
                onChangeText={setNewListName}
                placeholder="Ex: Cabaz Semanal, Jantar"
                mode="outlined"
                style={styles.textInput}
                outlineColor={colors.borderStrong}
                activeOutlineColor={colors.primary}
              />
            )}
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            <Button textColor={colors.textMuted} onPress={() => setIsDialogVisible(false)}>Cancelar</Button>
            <Button mode="contained" buttonColor={colors.primary} textColor={colors.surface} onPress={handleSaveToBasket}>
              Confirmar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  syncLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  syncLoadingText: {
    marginTop: 16,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  syncLoadingHint: {
    marginTop: 6,
    color: colors.textMuted,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitleBlock: {
    flex: 1,
    flexShrink: 1,
    marginRight: 8,
  },
  headerTitle: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerIcon: {
    margin: 0,
    marginLeft: 8,
  },
  searchbar: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    elevation: 2,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  searchbarInput: {
    fontSize: 14,
    textAlignVertical: 'center',
    paddingVertical: 0,
  },
  filterBar: {
    paddingVertical: 4,
  },
  categoryBar: {
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterScroll: {
    paddingHorizontal: 16,
  },
  filterChip: {
    marginRight: 6,
    borderRadius: 18,
    minHeight: 38,
    height: undefined,
    paddingVertical: 6,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtext: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 8,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  dialogTitle: {
    textAlign: 'center',
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  dialogProductInfo: {
    marginBottom: 16,
    backgroundColor: colors.surfaceVariant,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  dialogProductName: {
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  sectionLabel: {
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 8,
    color: colors.textSecondary,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  quantityDisplay: {
    width: 60,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 6,
    marginHorizontal: 12,
  },
  quantityText: {
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  listsContainer: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  listsScroll: {
    maxHeight: 120,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  radioLabel: {
    marginLeft: 8,
    color: colors.textSecondary,
  },
  textInput: {
    backgroundColor: colors.surface,
    marginTop: 4,
    fontSize: 14,
  },
  dialogActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});

const enhanceScreen = withObservables([], () => ({
  shoppingLists: database.collections.get('shopping_lists').query(
    Q.sortBy('created_at', Q.desc)
  ).observe(),
  favorites: database.collections.get('favorites').query().observe(),
  categories: database.collections.get('categories').query().observe(),
}));
export default enhanceScreen(SearchScreen);
