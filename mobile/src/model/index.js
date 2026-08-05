import { Model, Database } from '@nozbe/watermelondb';
import { field, date, readonly, children, relation } from '@nozbe/watermelondb/decorators';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import migrations from './migrations';

export class Supermarket extends Model {
  static table = 'supermarkets';
  @field('name') name;
  @field('slug') slug;
  @readonly @date('created_at') createdAt;
  @readonly @date('updated_at') updatedAt;
}

export class Category extends Model {
  static table = 'categories';
  @field('supermarket_id') supermarketId;
  @field('name') name;
  @field('slug') slug;
  @field('external_id') externalId;
  @readonly @date('created_at') createdAt;
  @readonly @date('updated_at') updatedAt;
}

export class Product extends Model {
  static table = 'products';
  @field('supermarket_id') supermarketId;
  @field('category_id') categoryId;
  @field('external_id') externalId;
  @field('name') name;
  @field('brand') brand;
  @field('description') description;
  @field('price') price;
  @field('price_currency') priceCurrency;
  @field('unit') unit;
  @field('url') url;
  @field('image_url') imageUrl;
  @field('in_stock') inStock;
  @field('deleted') deleted;
  @date('last_scraped_at') lastScrapedAt;
  @readonly @date('created_at') createdAt;
  @readonly @date('updated_at') updatedAt;
}

export class ShoppingList extends Model {
  static table = 'shopping_lists';
  static associations = {
    shopping_list_items: { type: 'has_many', foreignKey: 'list_id' },
  };

  @field('name') name;
  @readonly @date('created_at') createdAt;

  @children('shopping_list_items') items;
}

export class ShoppingListItem extends Model {
  static table = 'shopping_list_items';
  static associations = {
    shopping_lists: { type: 'belongs_to', key: 'list_id' },
    products: { type: 'belongs_to', key: 'product_id' },
  };

  @field('list_id') listId;
  @field('product_id') productId;
  @field('quantity') quantity;

  @relation('shopping_lists', 'list_id') shoppingList;
  @relation('products', 'product_id') product;
}

export class Favorite extends Model {
  static table = 'favorites';
  static associations = {
    products: { type: 'belongs_to', key: 'product_id' },
  };

  @field('product_id') productId;
  @readonly @date('created_at') createdAt;

  @relation('products', 'product_id') product;
}

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'PriceScoutPT',
  jsi: false,
  onSetUpError: error => {
    console.error("Database setup error:", error);
  }
});

export const database = new Database({
  adapter,
  modelClasses: [Supermarket, Category, Product, ShoppingList, ShoppingListItem, Favorite],
});
