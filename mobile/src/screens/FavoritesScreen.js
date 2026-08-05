import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, IconButton, Surface, Portal, Dialog, Button, TextInput, RadioButton } from 'react-native-paper';
import { Q } from '@nozbe/watermelondb';
import withObservables from '@nozbe/with-observables';
import { database } from '../model';
import ProductHistoryModal from '../components/ProductHistoryModal';
import ProductCard, { getSupermarket } from '../components/ProductCard';
import { colors } from '../theme';

// Card de Favorito Reativo que observa as atualizações do produto correspondente
const FavoriteCard = ({ favorite, product, onRemove, onAddToBasket, onViewHistory }) => {
  if (!product) return null;

  return (
    <View>
      <ProductCard
        product={product}
        isFavorite
        onToggleFavorite={() => onRemove(favorite)}
        onAddToBasket={onAddToBasket}
        onPress={() => onViewHistory(product)}
      />
    </View>
  );
};

// Tornar o card de favoritos reativo com Jons no WatermelonDB
const EnhancedFavoriteCard = withObservables(['favorite'], ({ favorite }) => ({
  favorite: favorite.observe(),
  product: favorite.product.observe(),
}))(FavoriteCard);

// Ecrã Central de Favoritos
const FavoritesScreen = ({ favorites, shoppingLists }) => {
  // Estados para o Modal de Histórico de Preços
  const [selectedProductForHistory, setSelectedProductForHistory] = useState(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  // Estados para o Modal de Adicionar ao Cabaz
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [selectedProductForBasket, setSelectedProductForBasket] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedListId, setSelectedListId] = useState('');
  const [isCreatingNewList, setIsCreatingNewList] = useState(false);
  const [newListName, setNewListName] = useState('');

  // Sincronizar seleção da lista ativa por defeito
  useEffect(() => {
    if (shoppingLists && shoppingLists.length > 0) {
      if (!selectedListId) {
        setSelectedListId(shoppingLists[0].id);
      }
    } else {
      setIsCreatingNewList(true);
    }
  }, [shoppingLists]);

  const handleRemoveFavorite = async (fav) => {
    try {
      await database.write(async () => {
        await fav.destroyPermanently();
      });
    } catch (e) {
      console.error("[FavoritesScreen Remove Error]:", e);
    }
  };

  const openAddToBasketDialog = (product) => {
    setSelectedProductForBasket(product);
    setQuantity(1);
    if (shoppingLists && shoppingLists.length > 0) {
      setIsCreatingNewList(false);
      setSelectedListId(shoppingLists[0].id);
    } else {
      setIsCreatingNewList(true);
      setSelectedListId('new');
    }
    setIsDialogVisible(true);
  };

  const handleSaveToBasket = async () => {
    if (!selectedProductForBasket) return;

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

        // Verificar se produto já está na lista para apenas somar a quantidade
        const existingItems = await database.collections.get('shopping_list_items').query(
          Q.where('list_id', targetList.id),
          Q.where('product_id', selectedProductForBasket.id)
        ).fetch();

        if (existingItems.length > 0) {
          await existingItems[0].update((item) => {
            item.quantity += quantity;
          });
        } else {
          await database.collections.get('shopping_list_items').create((item) => {
            item.listId = targetList.id;
            item.productId = selectedProductForBasket.id;
            item.quantity = quantity;
          });
        }
      });
      
      setIsDialogVisible(false);
      setNewListName('');
    } catch (e) {
      console.error("[FavoritesScreen Save Basket Error]:", e);
    }
  };

  const handleViewHistory = (product) => {
    setSelectedProductForHistory(product);
    setIsHistoryVisible(true);
  };

  const toggleFavoriteFromHistory = async (product, isFav) => {
    // Como estamos no ecrã de favoritos, favoritar do histórico significa apenas destruir o favorito caso isFav seja true
    if (isFav) {
      try {
        await database.write(async () => {
          const favs = await database.collections.get('favorites').query(
            Q.where('product_id', product.id)
          ).fetch();
          for (const fav of favs) {
            await fav.destroyPermanently();
          }
        });
        setIsHistoryVisible(false);
      } catch (e) {
        console.error("[FavoritesScreen Toggle History Error]:", e);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.headerTitle} accessibilityRole="header">Os Meus Favoritos</Text>
      </View>

      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EnhancedFavoriteCard
            favorite={item}
            onRemove={handleRemoveFavorite}
            onAddToBasket={openAddToBasketDialog}
            onViewHistory={handleViewHistory}
          />
        )}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <IconButton icon="heart-broken" size={60} iconColor={colors.borderStrong} accessible={false} importantForAccessibility="no-hide-descendants" />
            <Text variant="titleMedium" style={styles.emptyText}>Sem favoritos guardados</Text>
            <Text variant="bodyMedium" style={styles.emptySubtext}>
              Clica no ícone do coração na barra de pesquisa ou no histórico de produtos para guardares os teus produtos recorrentes aqui.
            </Text>
          </View>
        )}
      />

      {/* Modal de Histórico de Preços */}
      <ProductHistoryModal
        product={selectedProductForHistory}
        visible={isHistoryVisible}
        onDismiss={() => setIsHistoryVisible(false)}
        isFavorite={true}
        onToggleFavorite={toggleFavoriteFromHistory}
      />

      {/* Diálogo de Adicionar ao Cabaz */}
      <Portal>
        <Dialog visible={isDialogVisible} onDismiss={() => setIsDialogVisible(false)} style={styles.dialog}>
          <Dialog.Title style={styles.dialogTitle}>Adicionar ao Meu Cabaz</Dialog.Title>
          <Dialog.Content>
            {selectedProductForBasket && (
              <View style={styles.dialogProductInfo}>
                <Text variant="titleMedium" style={styles.dialogProductName}>{selectedProductForBasket.name}</Text>
                <Text variant="bodyMedium" style={{ color: getSupermarket(selectedProductForBasket.supermarketId).color, fontWeight: 'bold' }}>
                  Preço: {parseFloat(selectedProductForBasket.price).toFixed(2)} € em {getSupermarket(selectedProductForBasket.supermarketId).name}
                </Text>
              </View>
            )}

            {/* Ajuste de Quantidade */}
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

            {/* Escolha da Lista de Compras */}
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

            {/* Nome da Nova Lista */}
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
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 32,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontWeight: 'bold',
    marginTop: 12,
  },
  emptySubtext: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 8,
    lineHeight: 20,
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

// Decorar o ecrã para observar as tabelas reativamente
const enhanceScreen = withObservables([], () => ({
  favorites: database.collections.get('favorites').query(
    Q.sortBy('created_at', Q.desc)
  ).observe(),
  shoppingLists: database.collections.get('shopping_lists').query(
    Q.sortBy('created_at', Q.desc)
  ).observe()
}));
export default enhanceScreen(FavoritesScreen);
