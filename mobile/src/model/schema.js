import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 6,
  tables: [
    tableSchema({
      name: 'supermarkets',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'slug', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' }
      ]
    }),
    tableSchema({
      name: 'categories',
      columns: [
        { name: 'supermarket_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'slug', type: 'string' },
        { name: 'external_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' }
      ]
    }),
    tableSchema({
      name: 'products',
      columns: [
        { name: 'supermarket_id', type: 'string', isIndexed: true },
        { name: 'category_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'external_id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'brand', type: 'string', isOptional: true },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'price', type: 'number' },
        { name: 'price_currency', type: 'string' },
        { name: 'unit', type: 'string', isOptional: true },
        { name: 'url', type: 'string', isOptional: true },
        { name: 'image_url', type: 'string', isOptional: true },
        { name: 'barcode', type: 'string', isOptional: true },
        { name: 'regular_price', type: 'number', isOptional: true },
        { name: 'unit_price', type: 'number', isOptional: true },
        { name: 'unit_price_unit', type: 'string', isOptional: true },
        { name: 'source_type', type: 'string', isOptional: true },
        { name: 'source_url', type: 'string', isOptional: true },
        { name: 'store_location', type: 'string', isOptional: true },
        { name: 'observed_at', type: 'number', isOptional: true },
        { name: 'requires_loyalty_card', type: 'boolean' },
        { name: 'valid_from', type: 'number', isOptional: true },
        { name: 'valid_to', type: 'number', isOptional: true },
        { name: 'in_stock', type: 'boolean' },
        { name: 'deleted', type: 'boolean' },
        { name: 'last_scraped_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' }
      ]
    }),
    tableSchema({
      name: 'shopping_lists',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'created_at', type: 'number' }
      ]
    }),
    tableSchema({
      name: 'shopping_list_items',
      columns: [
        { name: 'list_id', type: 'string', isIndexed: true },
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'quantity', type: 'number' }
      ]
    }),
    tableSchema({
      name: 'favorites',
      columns: [
        { name: 'product_id', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' }
      ]
    })
  ]
});
