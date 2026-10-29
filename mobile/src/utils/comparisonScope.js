const PUBLIC_COMPARISON_SOURCES = Object.freeze(['online_catalog', 'public_listing', 'leaflet', 'authorised_feed', '']);

function comparisonLocation(product) {
  const location = product.storeLocation ?? product.store_location ?? product._raw?.store_location;
  return typeof location === 'string' && location.trim() ? location.trim() : null;
}

function isPublicComparisonSource(product) {
  const source = product.sourceType ?? product.source_type ?? product._raw?.source_type;
  // Records predating source metadata came from the public scrapers.
  return source == null || PUBLIC_COMPARISON_SOURCES.includes(source);
}

function isInComparisonContext(product, context) {
  if (!product || !context) return false;
  const supermarketId = product.supermarketId ?? product.supermarket_id ?? product._raw?.supermarket_id;
  if (supermarketId !== context.supermarketId || comparisonLocation(product) !== comparisonLocation(context)) return false;
  return comparisonLocation(context) !== null || isPublicComparisonSource(product);
}

// Input rows are aggregates of current, available, non-card prices by chain and
// location. Choose one scope once; every item in that chain's basket uses it.
function selectComparisonContexts(rows) {
  const bySupermarket = new Map();
  for (const row of rows) {
    const supermarketId = row.supermarketId ?? row.supermarket_id;
    const storeLocation = comparisonLocation(row);
    const count = Number(row.productCount ?? row.product_count ?? 0);
    const latest = Number(row.latestObservedAt ?? row.latest_observed_at ?? 0) || 0;
    if (!supermarketId || !Number.isFinite(count) || count <= 0 || (!storeLocation && !isPublicComparisonSource(row))) continue;
    const candidate = { supermarketId, storeLocation, productCount: count, latestObservedAt: latest };
    const current = bySupermarket.get(supermarketId);
    const preferred = !current
      || (storeLocation === null && current.storeLocation !== null)
      || ((storeLocation === null) === (current.storeLocation === null)
        && (count > current.productCount
          || (count === current.productCount && latest > current.latestObservedAt)
          || (count === current.productCount && latest === current.latestObservedAt
            && (storeLocation || '').localeCompare(current.storeLocation || '', 'pt-PT') < 0)));
    if (preferred) bySupermarket.set(supermarketId, candidate);
  }
  return [...bySupermarket.values()].sort((a, b) => a.supermarketId.localeCompare(b.supermarketId))
    .map(({ supermarketId, storeLocation }) => ({
      supermarketId, storeLocation, label: storeLocation || 'Catálogo público',
    }));
}

module.exports = { PUBLIC_COMPARISON_SOURCES, comparisonLocation, isInComparisonContext, selectComparisonContexts };
