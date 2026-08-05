import { schemaMigrations, createTable } from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'shopping_lists',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'created_at', type: 'number' }
          ]
        }),
        createTable({
          name: 'shopping_list_items',
          columns: [
            { name: 'list_id', type: 'string', isIndexed: true },
            { name: 'product_id', type: 'string', isIndexed: true },
            { name: 'quantity', type: 'number' }
          ]
        })
      ]
    },
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'favorites',
          columns: [
            { name: 'product_id', type: 'string', isIndexed: true },
            { name: 'created_at', type: 'number' }
          ]
        })
      ]
    },
    {
      toVersion: 4,
      steps: [
        createTable({
          name: 'categories',
          columns: [
            { name: 'supermarket_id', type: 'string', isIndexed: true },
            { name: 'name', type: 'string' },
            { name: 'slug', type: 'string' },
            { name: 'external_id', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' }
          ]
        })
      ]
    }
  ]
});
