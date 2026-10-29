// Product UUIDs belong to one server database. Retailer identities survive a
// restored database, so user-owned references must follow this exact pair.
function productIdentity(product) {
  if (!product) return null;
  const supermarket = product.supermarket_id ?? product.supermarketId;
  const external = product.external_id ?? product.externalId;
  return typeof supermarket === 'string' && supermarket && typeof external === 'string' && external
    ? JSON.stringify([supermarket, external]) : null;
}

function normalizeCatalogEndpoint(endpoint) {
  return String(endpoint || '').trim().replace(/\/+$/, '');
}

function requiresCatalogSnapshot(savedSource, endpoint, sourceSchema, lastPulledAt) {
  if (sourceSchema !== '6' || !lastPulledAt) return true;
  try {
    const source = JSON.parse(savedSource);
    return source?.version !== 1 || source.endpoint !== normalizeCatalogEndpoint(endpoint);
  } catch {
    return true;
  }
}

const referenceProductId = (record) => record.product_id ?? record.productId;
const referenceListId = (record) => record.list_id ?? record.listId;
const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Plan a bounded reconciliation without mutating Watermelon Models. References
// to a replacement and its old UUID can coexist: collapse favorites and add
// basket quantities instead of dropping either user's selection.
function planCatalogReconciliation(staleProducts, remoteByIdentity, favorites = [], items = []) {
  const staleIds = new Set(staleProducts.map((product) => product.id));
  const replacements = new Map();
  for (const product of staleProducts) {
    const identity = productIdentity(product);
    const replacement = identity && remoteByIdentity.get(identity);
    if (replacement && replacement !== product.id) replacements.set(product.id, replacement);
  }
  const retained = new Set();
  const favoriteUpdates = [];
  const favoriteDeletes = [];
  const itemUpdates = [];
  const itemDeletes = [];

  function groupReferences(records, keyFor) {
    const groups = new Map();
    for (const record of records) {
      const previous = referenceProductId(record);
      const target = replacements.get(previous) || previous;
      if (staleIds.has(previous) && !replacements.has(previous)) retained.add(previous);
      const key = keyFor(record, target);
      if (!groups.has(key)) groups.set(key, { target, records: [] });
      groups.get(key).records.push(record);
    }
    return [...groups.values()].filter((group) => group.records.some((record) => staleIds.has(referenceProductId(record))));
  }

  function chooseSurvivor(records, target) {
    return [...records].sort((a, b) => Number(referenceProductId(b) === target) - Number(referenceProductId(a) === target)
      || compareIds(a, b));
  }

  for (const { target, records } of groupReferences(favorites, (_, target) => target)) {
    const [survivor, ...duplicates] = chooseSurvivor(records, target);
    if (referenceProductId(survivor) !== target) favoriteUpdates.push({ id: survivor.id, productId: target });
    favoriteDeletes.push(...duplicates.map((record) => record.id));
  }
  for (const { target, records } of groupReferences(items, (record, target) => JSON.stringify([referenceListId(record), target]))) {
    const [survivor, ...duplicates] = chooseSurvivor(records, target);
    const quantity = records.reduce((total, record) => {
      const amount = Number(record.quantity);
      return total + (Number.isFinite(amount) ? amount : 0);
    }, 0);
    if (referenceProductId(survivor) !== target || Number(survivor.quantity) !== quantity) {
      itemUpdates.push({ id: survivor.id, productId: target, quantity });
    }
    itemDeletes.push(...duplicates.map((record) => record.id));
  }
  return {
    favoriteUpdates, favoriteDeletes, itemUpdates, itemDeletes,
    unavailableProductIds: [...retained],
    deleteProductIds: staleProducts.filter((product) => !retained.has(product.id)).map((product) => product.id),
  };
}

module.exports = { productIdentity, normalizeCatalogEndpoint, requiresCatalogSnapshot, planCatalogReconciliation };
