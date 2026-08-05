import React, { useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { colors } from '../theme';
import { Card, Text, IconButton, Badge } from 'react-native-paper';

// Identidade visual dos supermercados (fonte única para toda a app)
export const SUPERMARKET_BRANDS = {
  '00000000-0000-0000-0000-000000000001': { name: 'Continente', color: colors.danger },
  '00000000-0000-0000-0000-000000000002': { name: 'Lidl', color: '#0050AA' },
  '00000000-0000-0000-0000-000000000003': { name: 'Pingo Doce', color: '#2B8C3D' },
  '00000000-0000-0000-0000-000000000004': { name: 'Aldi', color: '#003A70' },
};

export const getSupermarket = (id) =>
  SUPERMARKET_BRANDS[id] || { name: 'Supermercado', color: colors.textMuted };

export const formatPrice = (price) => {
  const value = parseFloat(price);
  return Number.isFinite(value) ? `${value.toFixed(2)} €` : '—';
};

// Imagem do produto com fallback elegante para quando não existe imagem
const ProductImage = ({ url, color, size }) => {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <View
        style={[styles.imageFallback, { backgroundColor: `${color}22`, width: size, height: size }]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.imageFallbackIcon, { backgroundColor: color }]} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: 10 }}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
};

const ProductCard = ({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToBasket,
  onPress,
  compact = false,
}) => {
  const brandInfo = getSupermarket(product.supermarketId);
  const imgSize = compact ? 56 : 72;

  return (
    <Card
      style={styles.card}
      mode="outlined"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatPrice(product.price)}, ${brandInfo.name}`}
      accessibilityHint="Abre o histórico de preços do produto"
    >
      <View style={styles.row}>
        <View style={[styles.imageWrap, { borderColor: brandInfo.color }]} accessible={false} importantForAccessibility="no-hide-descendants">
          <ProductImage url={product.imageUrl} color={brandInfo.color} size={imgSize} />
        </View>

        <View style={styles.info}>
          <Text variant="titleSmall" style={styles.name} numberOfLines={2}>
            {product.name}
          </Text>
          <Text variant="bodySmall" style={styles.brand} numberOfLines={1}>
            {product.brand ? product.brand : 'Marca própria'}
            {product.unit ? ` · ${product.unit}` : ''}
          </Text>
          <View style={styles.bottomRow}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: brandInfo.color }]}>
                <Text style={styles.badgeText}>{brandInfo.name}</Text>
              </View>
            </View>
            <Text variant="titleMedium" style={[styles.price, { color: brandInfo.color }]}>
              {formatPrice(product.price)}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <IconButton
            icon={isFavorite ? 'heart' : 'heart-outline'}
            iconColor={isFavorite ? colors.danger : colors.borderStrong}
            size={22}
            style={styles.actionIcon}
            accessibilityLabel={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            accessibilityState={{ selected: isFavorite }}
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              onToggleFavorite(product, isFavorite);
            }}
          />
          <IconButton
            icon="cart-plus"
            size={22}
            iconColor={brandInfo.color}
            style={styles.actionIcon}
            accessibilityLabel="Adicionar ao cabaz"
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              onAddToBasket(product);
            }}
          />
        </View>
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  imageWrap: {
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden',
    marginRight: 12,
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallbackIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginRight: 4,
  },
  name: {
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  brand: {
    color: colors.textMuted,
    marginBottom: 6,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: 'bold',
  },
  price: {
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  actionIcon: {
    margin: 0,
    padding: 0,
    width: 44,
    height: 44,
  },
});

export default ProductCard;
