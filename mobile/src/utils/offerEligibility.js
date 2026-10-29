function value(product, camel, snake) {
  return product[camel] ?? product[snake] ?? product._raw?.[snake];
}

function timestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : new Date(value).getTime();
}

// Used by search and comparison so a future/expired or conditional offer cannot
// silently become the cheapest available price.
function isOfferCurrent(product, now = Date.now(), includeLoyalty = false) {
  if (!product || Number(product.price) <= 0 || !Number.isFinite(Number(product.price))) return false;
  const inStock = value(product, 'inStock', 'in_stock');
  if (value(product, 'deleted', 'deleted') || inStock === false || inStock === 0 || product._raw?._status === 'deleted') return false;
  if (!includeLoyalty && value(product, 'requiresLoyaltyCard', 'requires_loyalty_card')) return false;
  const from = timestamp(value(product, 'validFrom', 'valid_from'));
  const to = timestamp(value(product, 'validTo', 'valid_to'));
  return (from === null || (Number.isFinite(from) && from <= now)) &&
    (to === null || (Number.isFinite(to) && to >= now));
}

module.exports = { isOfferCurrent };
