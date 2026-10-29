import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../model';
import { createProductSearchIndex } from './searchCore';

const INDEX_BATCH_SIZE = 2000;
const OBSERVED_COLUMNS = [
  'name', 'brand', 'price', 'unit', 'image_url', 'in_stock', 'deleted',
  'last_scraped_at', 'regular_price', 'unit_price', 'unit_price_unit',
  'source_type', 'store_location', 'observed_at', 'requires_loyalty_card', 'valid_from', 'valid_to',
];

const fromRecord = (record) => ({
  id: record.id, name: record.name, brand: record.brand, unit: record.unit,
  barcode: record.barcode,
  supermarketId: record.supermarketId, categoryId: record.categoryId,
  price: record.price, inStock: record.inStock, deleted: record.deleted,
  validFrom: record.validFrom, validTo: record.validTo,
  requiresLoyaltyCard: record.requiresLoyaltyCard,
});

const fromRaw = (row) => ({
  id: row.id, name: row.name, brand: row.brand, unit: row.unit,
  barcode: row.barcode,
  supermarketId: row.supermarket_id, categoryId: row.category_id,
  price: row.price, inStock: row.in_stock, deleted: row.deleted,
  validFrom: row.valid_from, validTo: row.valid_to,
  requiresLoyaltyCard: row.requires_loyalty_card,
});

export function useProductSearch(query, options) {
  const indexRef = useRef(createProductSearchIndex());
  const [revision, setRevision] = useState(0);
  const [reload, setReload] = useState(0);
  const [indexLoading, setIndexLoading] = useState(true);
  const [fetchingProducts, setFetchingProducts] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState({ key: '', products: [] });
  const retry = useCallback(() => setReload((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let ready = false;
    let publishTimer;
    const pending = new Map();
    const index = createProductSearchIndex();
    const collection = database.collections.get('products');
    indexRef.current = index;
    setIndexLoading(true);
    setError('');
    setPage({ key: '', products: [] });
    const publish = () => {
      clearTimeout(publishTimer);
      // Sync applies thousands of updates in each batch. Publish once per batch,
      // retaining the index instead of rescanning or materializing the catalogue.
      publishTimer = setTimeout(() => {
        if (active) setRevision((value) => value + 1);
      }, 120);
    };
    const unsubscribe = collection.experimentalSubscribe((changes) => {
      for (const { record, type } of changes) {
        if (!ready) pending.set(record.id, type === 'destroyed' ? null : fromRecord(record));
        else if (type === 'destroyed') index.remove(record.id);
        else index.upsert(fromRecord(record));
      }
      if (ready) publish();
    });

    async function loadIndex() {
      try {
        let lastId = '';
        while (active) {
          // Select a compact projection in bounded batches. Fetching every full
          // product Model here would retain descriptions/images and exhaust RAM
          // on the same 56k catalogue that sync deliberately loads in batches.
          const rows = await collection.query(Q.unsafeSqlQuery(
            'SELECT id, name, brand, unit, barcode, supermarket_id, category_id, price, in_stock, deleted, valid_from, valid_to, requires_loyalty_card '
              + 'FROM products WHERE _status != ? AND deleted = 0 AND in_stock = 1 AND id > ? ORDER BY id LIMIT ?',
            ['deleted', lastId, INDEX_BATCH_SIZE]
          )).unsafeFetchRaw();
          if (!active) return;
          for (const row of rows) index.upsert(fromRaw(row));
          if (rows.length < INDEX_BATCH_SIZE) break;
          lastId = rows[rows.length - 1].id;
          // Give typing/animations a chance to run between native batches.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!active) return;
        for (const [id, product] of pending) {
          if (product) index.upsert(product);
          else index.remove(id);
        }
        pending.clear();
        ready = true;
        setRevision((value) => value + 1);
        setIndexLoading(false);
      } catch (e) {
        if (!active) return;
        console.error('[Local search index]', e);
        setError('Não foi possível abrir o catálogo guardado. Tenta novamente.');
        setIndexLoading(false);
      }
    }
    loadIndex();
    // Offer validity can change while this screen stays open, without a sync.
    const validityTimer = setInterval(() => {
      if (ready && active) setRevision((value) => value + 1);
    }, 60000);
    return () => {
      active = false;
      unsubscribe();
      clearTimeout(publishTimer);
      clearInterval(validityTimer);
    };
  }, [reload]);

  const { supermarketId, categoryId, sort, limit, includeLoyalty } = options;
  const result = useMemo(() => indexRef.current.search(query, { supermarketId, categoryId, sort, limit, includeLoyalty }),
    [query, supermarketId, categoryId, sort, limit, includeLoyalty, revision]);
  const filters = useMemo(() => indexRef.current.filters(), [revision]);
  const idsKey = result.ids.join(',');

  useEffect(() => {
    if (!result.ids.length) {
      setPage({ key: idsKey, products: [] });
      setFetchingProducts(false);
      return;
    }
    setFetchingProducts(true);
    setError('');
    const positions = new Map(result.ids.map((id, position) => [id, position]));
    const subscription = database.collections.get('products').query(
      Q.where('id', Q.oneOf(result.ids)), Q.where('deleted', false), Q.where('in_stock', true)
    ).observeWithColumns(OBSERVED_COLUMNS).subscribe({
      next(records) {
        setPage({ key: idsKey, products: [...records].sort((a, b) => positions.get(a.id) - positions.get(b.id)) });
        setFetchingProducts(false);
      },
      error(e) {
        console.error('[Local search products]', e);
        setPage({ key: idsKey, products: [] });
        setError('Não foi possível mostrar os produtos. Tenta novamente.');
        setFetchingProducts(false);
      },
    });
    return () => subscription.unsubscribe();
  }, [idsKey, reload]);

  // Keep an existing page while appending more, but never show an old query's
  // products under a new result count while its database request is in flight.
  const pageStillMatches = page.key === idsKey || (page.products.length > 0
    && page.products.every((product, position) => result.ids[position] === product.id));
  return {
    ...result, ...filters, products: pageStillMatches ? page.products : [],
    loading: indexLoading || fetchingProducts || (!pageStillMatches && result.ids.length > 0), error, retry,
  };
}
