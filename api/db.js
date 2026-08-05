const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required.');
}

// Limites pensados para o free tier (Azure Flexible Server B1ms: máx. ~35
// ligações de utilizador). O connectionTimeoutMillis faz com que pedidos
// falhem depressa em vez de ficarem pendurados quando a BD está sob pressão,
// e o statement_timeout evita que uma query lenta trave o contentor inteiro.
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  options: '-c statement_timeout=20000',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
