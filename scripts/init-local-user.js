require('dotenv').config();

const { execute, getPool, queryOne } = require('../api/db');

function printUsageAndExit() {
  console.error('Usage: npm run local:init-user -- <userId> <points>');
  console.error('Example: npm run local:init-user -- local-user-001 100');
  process.exit(1);
}

function parsePoints(value) {
  const points = Number(value);
  if (!Number.isInteger(points) || points < 0) {
    throw new Error('points must be a non-negative integer');
  }
  return points;
}

async function ensureTables() {
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
}

async function main() {
  const [, , userIdArg, pointsArg] = process.argv;
  const userId = String(userIdArg || '').trim();
  if (!userId || pointsArg === undefined) {
    printUsageAndExit();
  }

  const points = parsePoints(pointsArg);
  await ensureTables();

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
  console.log('[local:init-user] user ready:', JSON.stringify(row));
}

main()
  .catch((error) => {
    console.error('[local:init-user] failed:', error.message);
    if (error && error.code === 'ER_BAD_DB_ERROR') {
      console.error('[local:init-user] database does not exist. Run: npm run local:db:setup');
    }
    if (error && error.code === 'ECONNREFUSED') {
      console.error('[local:init-user] MySQL is not reachable. Start MySQL and check MYSQL_HOST/MYSQL_PORT in .env.');
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end().catch(() => {});
    }
  });
