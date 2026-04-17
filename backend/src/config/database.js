const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'videocall_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

/**
 * Execute a parameterized query (prevents SQL injection)
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    logger.debug('query executed', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Get a client from pool for transactions
 */
async function getClient() {
  const client = await pool.connect();
  const release = client.release.bind(client);
  client.release = () => {
    client.release = release;
    release();
  };
  return client;
}

module.exports = { query, getClient, pool };
