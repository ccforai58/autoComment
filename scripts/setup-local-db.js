require('dotenv').config();

const mysql = require('mysql2/promise');
const { execute, getPool, queryOne } = require('../api/db');

function getAdminConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    charset: 'utf8mb4'
  };
}

function getDatabaseName() {
  return process.env.MYSQL_DATABASE || 'auto_comment';
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function parsePoints(value) {
  if (value === undefined) return null;
  const points = Number(value);
  if (!Number.isInteger(points) || points < 0) {
    throw new Error('points must be a non-negative integer');
  }
  return points;
}

async function createDatabase() {
  const database = getDatabaseName();
  const conn = await mysql.createConnection(getAdminConfig());
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[local:db:setup] database ready: ${database}`);
  } finally {
    await conn.end();
  }
}

async function ensureCoreTables() {
  await execute(
    `
      CREATE TABLE IF NOT EXISTS auto_comment_users (
        user_id VARCHAR(255) PRIMARY KEY,
        points INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    []
  );

  await execute(
    `
      CREATE TABLE IF NOT EXISTS refund_points_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id VARCHAR(255) NOT NULL,
        batch_id VARCHAR(36) DEFAULT NULL,
        url TEXT DEFAULT NULL,
        points INT NOT NULL DEFAULT 1,
        reason VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_user_refund_date (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    []
  );

  const blockedKeywords = require('../api/blocked-keywords');
  const blogRunStats = require('../api/blog-run-stats');
  const batch = require('../api/batch');

  await blockedKeywords.loadBlockedKeywords();
  await blogRunStats.ensureTable();
  await batch.ensureTables();

  console.log('[local:db:setup] core tables ready');
}

async function upsertUser(userId, points) {
  if (!userId || points === null) return;

  await execute(
    `
      INSERT INTO auto_comment_users (user_id, points, updated_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        points = VALUES(points),
        updated_at = NOW()
    `,
    [userId, points]
  );

  const row = await queryOne('SELECT user_id, points, updated_at FROM auto_comment_users WHERE user_id = ?', [userId]);
  console.log('[local:db:setup] user ready:', JSON.stringify(row));
}

async function main() {
  const [, , userIdArg, pointsArg] = process.argv;
  const userId = String(userIdArg || '').trim();
  const points = parsePoints(pointsArg);

  if ((userId && points === null) || (!userId && points !== null)) {
    throw new Error('Provide both userId and points, or neither. Example: npm run local:db:setup -- local-user-001 100');
  }

  await createDatabase();
  await ensureCoreTables();
  await upsertUser(userId, points);

  console.log('[local:db:setup] done');
}

main()
  .catch((error) => {
    console.error('[local:db:setup] failed:', error.message);
    if (error && error.code === 'ECONNREFUSED') {
      console.error('[local:db:setup] MySQL is not reachable. Start MySQL and check MYSQL_HOST/MYSQL_PORT in .env.');
    }
    if (error && error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('[local:db:setup] MySQL rejected the configured user/password. Check MYSQL_USER/MYSQL_PASSWORD in .env.');
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end().catch(() => {});
    }
  });
