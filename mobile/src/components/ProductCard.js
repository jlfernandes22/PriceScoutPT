import React, { useState, useEffect, memo } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { colors, supermarketBrands } from '../theme';
import { Card, Text, IconButton, Icon } from 'react-native-paper';
import { formatUnitPrice } from '../utils/unitPrice';

// Identidade visual dos supermercados (cores vivem em theme.js — fonte única)
export const SUPERMARKET_BRANDS = {
  '00000000-0000-0000-0000-000000000001': { name: 'Continente', color: supermarketBrands.continente },
  '00000000-0000-0000-0000-000000000002': { name: 'Lidl', color: supermarketBrands.lidl },
  '00000000-0000-0000-0000-000000000003': { name: 'Pingo Doce', color: supermarketBrands.pingodoce },
  '00000000-0000-0000-0000-000000000004': { name: 'Aldi', color: supermarketBrands.aldi },
  '00000000-0000-0000-0000-000000000005': { name: 'Auchan', color: supermarketBrands.auchan },
  '00000000-0000-0000-0000-000000000006': { name: 'Mercadona', color: supermarketBrands.mercadona },
  '00000000-0000-0000-0000-000000000007': { name: 'Intermarché', color: supermarketBrands.intermarche },
  '00000000-0000-0000-0000-000000000008': { name: 'El Corte Inglés', color: supermarketBrands.elcorteingles },
  '00000000-0000-0000-0000-000000000009': { name: 'Froiz', color: supermarketBrands.froiz },
  '00000000-0000-0000-0000-000000000010': { name: 'Minipreço', color: supermarketBrands.minipreco },
  '00000000-0000-0000-0000-000000000011': { name: 'E.Leclerc', color: supermarketBrands.eleclerc },
  '00000000-0000-0000-0000-000000000012': { name: 'Amanhecer', color: supermarketBrands.amanhecer },
  '00000000-0000-0000-0000-000000000013': { name: 'SPAR', color: supermarketBrands.spar },
};

export const getSupermarket = (id) =>
  SUPERMARKET_BRANDS[id] || { name: 'Supermercado', color: colors.textMuted };

export const formatPrice = (price) => {
  const value = parseFloat(price);
  // Preço 0/ausente = produto sem preço (indisponível) — nunca mostrar "0,00 €".
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(2).replace('.', ',')} €` : '—';
};

const SOURCE_LABELS = {
  online_catalog: 'Catálogo online',
  public_listing: 'Ofertas públicas',
  leaflet: 'Folheto',
  manual: 'Preço observado',
  receipt: 'Talão',
  authorised_feed: 'Catálogo importado',
};

export function productUnitPrice(product) {
  const value = Number(product.unitPrice);
  if (Number.isFinite(value) && value > 0 && product.unitPriceUnit) {
    const unit = String(product.unitPriceUnit).replace(/^€\s*\/?\s*/, '');
    return `${value.toFixed(2).replace('.', ',')} €/${unit}`;
  }
  return formatUnitPrice(product.price, product.unit, product.name);
}

export function getProductSourceInfo(product) {
  const source = SOURCE_LABELS[product.sourceType];
  const location = product.storeLocation || (['manual', 'receipt'].includes(product.sourceType) ? 'Localização não indicada' : '');
  const observed = product.observedAt || product.lastScrapedAt;
  const date = observed && new Date(observed);
  const parts = [source, location];
  if ((source || location) && date && Number.isFinite(date.getTime())) parts.push(date.toLocaleDateString('pt-PT'));
  return parts.filter(Boolean).join(' · ');
}

// Imagem do produto com fallback elegante para quando não existe imagem
export const ProductImage = ({ url, color, size }) => {
  const [failed, setFailed] = useState(false);

  // Uma URL que falhou uma vez (404 temporário) não pode falhar para sempre:
  // a sync atualiza image_url no mesmo registo (mesma instância React).
  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    return (
      <View
        style={[styles.imageFallback, { backgroundColor: `${color}14`, width: size, height: size }]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Icon source="basket-outline" size={Math.round(size * 0.38)} color={`${color}99`} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: 10 }}
      resizeMode="cover"
      resizeMethod="resize"
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
  const unitPrice = productUnitPrice(product);
  const regularPrice = Number(product.regularPrice);
  const hasDiscount = regularPrice > Number(product.price) && Number(product.price) > 0;
  const sourceInfo = getProductSourceInfo(product);

  return (
    <Card
      style={styles.card}
      mode="outlined"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatPrice(product.price)}, ${brandInfo.name}${product.requiresLoyaltyCard ? ', requer cartão de fidelização' : ''}${unitPrice ? `, ${unitPrice}` : ''}${sourceInfo ? `, ${sourceInfo}` : ''}`}
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
          {product.requiresLoyaltyCard && <Text variant="labelSmall" style={styles.loyaltyLabel}>Preço com cartão</Text>}
          <View style={styles.bottomRow}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: brandInfo.color }]}>
                <Text style={styles.badgeText}>{brandInfo.name}</Text>
              </View>
            </View>
            <View style={styles.priceBlock}>
              {hasDiscount && <Text variant="bodySmall" style={styles.regularPrice} accessibilityLabel={`Preço habitual ${formatPrice(regularPrice)}`}>{formatPrice(regularPrice)}</Text>}
              <Text variant="titleMedium" style={[styles.price, { color: brandInfo.color }]}>
                {formatPrice(product.price)}
              </Text>
            </View>
          </View>
          {unitPrice && <Text variant="bodySmall" style={styles.unitPrice}>{unitPrice}</Text>}
          {sourceInfo && !compact && <Text variant="labelSmall" style={styles.sourceInfo}>{sourceInfo}</Text>}
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
    fontSize: 12,
    fontWeight: 'bold',
  },
  price: {
    fontWeight: 'bold',
  },
  priceBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  regularPrice: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  unitPrice: {
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 2,
  },
  sourceInfo: {
    color: colors.textMuted,
    marginTop: 4,
  },
  loyaltyLabel: {
    color: colors.warning,
    marginBottom: 4,
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

export default memo(ProductCard);
