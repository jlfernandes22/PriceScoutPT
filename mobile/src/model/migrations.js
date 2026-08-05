import { schemaMigrations, createTable, unsafeExecuteSql } from '@nozbe/watermelondb/Schema/migrations';

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
    },
    {
      toVersion: 5,
      steps: [
        // Índices de leitura: a pesquisa e o fuzzy-match filtram por
        // supermercado/categoria antes do LIKE no nome. Sem índice, cada
        // query varre as ~93k linhas; com ele, só as do supermercado/categoria.
        // (Nome igual ao que o WatermelonDB cria via isIndexed para instalações novas.
        //  Nota: o runner nativo separa statements por ';' — obrigatório no fim.)
        unsafeExecuteSql(
          'CREATE INDEX IF NOT EXISTS products_supermarket_id ON products (supermarket_id);'
        ),
        unsafeExecuteSql(
          'CREATE INDEX IF NOT EXISTS products_category_id ON products (category_id);'
        ),
      ]
    }
  ]
});
