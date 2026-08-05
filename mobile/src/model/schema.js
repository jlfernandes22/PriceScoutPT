import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 4,
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
        { name: 'supermarket_id', type: 'string' },
        { name: 'category_id', type: 'string', isOptional: true },
        { name: 'external_id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'brand', type: 'string', isOptional: true },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'price', type: 'number' },
        { name: 'price_currency', type: 'string' },
        { name: 'unit', type: 'string', isOptional: true },
        { name: 'url', type: 'string', isOptional: true },
        { name: 'image_url', type: 'string', isOptional: true },
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
