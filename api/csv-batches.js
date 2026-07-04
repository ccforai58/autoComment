const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');

const { execute, getPool, query, queryOne } = require('./db');

const router = express.Router();

const EXPORT_BATCH_SIZE = Number(process.env.CSV_EXPORT_BATCH_SIZE || 250);
const EXPORT_LOCK_NAME = 'csv_batch_export';
const CSV_STORAGE_DIR = path.resolve(__dirname, '..', 'storage', 'csv-batches');
const CSV_BATCH_PLAN_ID = 'csv_batch';
const DEFAULT_BATCH_PRICE = process.env.CSV_BATCH_PRICE || '19.90';

let tablesReadyPromise = null;
let schedulerStarted = false;
let schedulerTimer = null;

function normalizeUserId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBatchId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function toDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateOnly(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateCompact(value) {
  return formatDateOnly(value).replace(/-/g, '');
}

function formatDateTime(value) {
  const date = toDate(value);
  return date ? date.toISOString() : value || null;
}

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : String(value || DEFAULT_BATCH_PRICE);
}

function csvEscape(value) {
  if (value === null || typeof value === 'undefined') return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows) {
  const header = [
    '页面AS',
    '原URL',
    'URL对应域名',
    '目标域名',
    '类型',
    '外部链接数量',
    '验证结果',
    '记录时间'
  ];
  const lines = rows.map((row) => [
    row.page_as || '',
    row.original_url || '',
    row.url_domain || '',
    row.target_domain || '',
    row.link_type || '',
    Number.isFinite(Number(row.external_link_count)) ? Number(row.external_link_count) : 0,
    row.validation_result === 2 ? '失败' : '成功',
    formatDateTime(row.created_at)
  ].map(csvEscape).join(','));

  return `\uFEFF${header.map(csvEscape).join(',')}\n${lines.join('\n')}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getTokenSecret() {
  return String(
    process.env.PURCHASE_TOKEN_SECRET ||
    process.env.ALIPAY_APP_ID ||
    'auto-comment-dev-purchase-token-secret'
  );
}

function createPurchaseToken({ userId, batchId, outTradeNo }) {
  return crypto
    .createHmac('sha256', getTokenSecret())
    .update(`${userId}:${batchId}:${outTradeNo}`)
    .digest('base64url');
}

function hashPurchaseToken(token) {
  return sha256(String(token || ''));
}

async function ensureTables() {
  if (!tablesReadyPromise) {
    tablesReadyPromise = (async () => {
      await execute(
        `
          CREATE TABLE IF NOT EXISTS csv_batches (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_no VARCHAR(64) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            storage_path VARCHAR(500) NOT NULL,
            sha256 VARCHAR(64) NOT NULL,
            row_count INT NOT NULL,
            source_start_date DATE NOT NULL,
            source_end_date DATE NOT NULL,
            source_started_at TIMESTAMP NOT NULL,
            source_ended_at TIMESTAMP NOT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 19.90,
            status VARCHAR(32) NOT NULL DEFAULT 'ready',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_csv_batches_batch_no (batch_no),
            UNIQUE KEY uk_csv_batches_file_name (file_name),
            INDEX idx_csv_batches_date_range (source_start_date, source_end_date),
            INDEX idx_csv_batches_status_created (status, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='可售 CSV 批次'
        `,
        []
      );

      await execute(
        `
          CREATE TABLE IF NOT EXISTS csv_batch_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            batch_id BIGINT UNSIGNED NOT NULL,
            blog_run_stat_id BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_csv_batch_items_source_once (blog_run_stat_id),
            UNIQUE KEY uk_csv_batch_items_batch_source (batch_id, blog_run_stat_id),
            INDEX idx_csv_batch_items_batch (batch_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CSV 批次包含的 blog_run_stats 行'
        `,
        []
      );

      await execute(
        `
          CREATE TABLE IF NOT EXISTS user_csv_purchases (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id VARCHAR(255) NOT NULL,
            batch_id BIGINT UNSIGNED NOT NULL,
            out_trade_no VARCHAR(64) NOT NULL,
            purchase_token_hash VARCHAR(64) NOT NULL,
            paid_at TIMESTAMP NULL DEFAULT NULL,
            granted_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_user_csv_purchases_user_batch (user_id, batch_id),
            UNIQUE KEY uk_user_csv_purchases_trade_no (out_trade_no),
            UNIQUE KEY uk_user_csv_purchases_token_hash (purchase_token_hash),
            INDEX idx_user_csv_purchases_user_created (user_id, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户 CSV 购买和下载权限记录'
        `,
        []
      );
    })().catch((error) => {
      tablesReadyPromise = null;
      throw error;
    });
  }
  return tablesReadyPromise;
}

function buildBatchResponse(row, purchase) {
  const token = purchase
    ? createPurchaseToken({
      userId: purchase.user_id,
      batchId: purchase.batch_id,
      outTradeNo: purchase.out_trade_no
    })
    : '';

  const batchId = Number(row.id || row.batch_id);
  return {
    batchId,
    batchNo: row.batch_no,
    fileName: row.file_name,
    dateRangeText: `${formatDateOnly(row.source_start_date)} 至 ${formatDateOnly(row.source_end_date)}`,
    sourceStartDate: formatDateOnly(row.source_start_date),
    sourceEndDate: formatDateOnly(row.source_end_date),
    rowCount: Number(row.row_count) || 0,
    price: formatAmount(row.price),
    status: row.status,
    purchaseStatus: purchase ? 'purchased' : (row.status === 'ready' ? 'available' : row.status),
    createdAt: formatDateTime(row.created_at),
    downloadToken: token || undefined,
    downloadUrl: token ? `/api/csv-batches/${batchId}/download?userId=${encodeURIComponent(purchase.user_id)}&token=${encodeURIComponent(token)}` : undefined
  };
}

function buildPaymentProduct(batch) {
  const price = formatAmount(batch.price);
  return {
    id: CSV_BATCH_PLAN_ID,
    batchId: Number(batch.id),
    name: batch.file_name,
    amount: price,
    subject: `AutoComment CSV ${batch.file_name}`,
    body: `${formatDateOnly(batch.source_start_date)} 至 ${formatDateOnly(batch.source_end_date)}，${batch.row_count} 条博客数据`
  };
}

async function getBatchById(batchId) {
  await ensureTables();
  return queryOne(
    `
      SELECT *
      FROM csv_batches
      WHERE id = ?
      LIMIT 1
    `,
    [batchId]
  );
}

async function getReadyBatchForPurchase(batchId) {
  const batch = await getBatchById(batchId);
  return batch && batch.status === 'ready' ? batch : null;
}

async function findUserPurchase(userId, batchId) {
  await ensureTables();
  return queryOne(
    `
      SELECT *
      FROM user_csv_purchases
      WHERE user_id = ?
        AND batch_id = ?
      LIMIT 1
    `,
    [userId, batchId]
  );
}

async function listBatches(req, res) {
  const userId = normalizeUserId(req.query && req.query.userId);
  if (!userId) {
    return res.status(400).json({ success: false, error: '缺少 userId 参数' });
  }

  try {
    await ensureTables();
    const rows = await query(
      `
        SELECT b.*, p.user_id AS purchase_user_id, p.out_trade_no AS purchase_out_trade_no, p.batch_id AS purchase_batch_id
        FROM csv_batches b
        LEFT JOIN user_csv_purchases p
          ON p.batch_id = b.id
         AND p.user_id = ?
        WHERE b.status IN ('ready', 'disabled')
        ORDER BY b.source_start_date DESC, b.id DESC
        LIMIT 100
      `,
      [userId]
    );

    return res.status(200).json({
      success: true,
      batches: rows.map((row) => {
        const purchase = row.purchase_out_trade_no ? {
          user_id: row.purchase_user_id,
          batch_id: row.purchase_batch_id,
          out_trade_no: row.purchase_out_trade_no
        } : null;
        return buildBatchResponse(row, purchase);
      })
    });
  } catch (error) {
    console.error('[csv-batches] list failed:', error);
    return res.status(500).json({
      success: false,
      error: '查询 CSV 列表失败',
      message: error.message
    });
  }
}

async function downloadBatch(req, res) {
  const batchId = normalizeBatchId(req.params && req.params.batchId);
  const userId = normalizeUserId(req.query && req.query.userId);
  const token = String((req.query && req.query.token) || '').trim();

  if (!batchId) {
    return res.status(400).json({ success: false, error: '无效的 batchId' });
  }
  if (!userId) {
    return res.status(400).json({ success: false, error: '缺少 userId 参数' });
  }
  if (!token) {
    return res.status(400).json({ success: false, error: '缺少购买凭证' });
  }

  try {
    await ensureTables();
    const row = await queryOne(
      `
        SELECT b.*, p.purchase_token_hash
        FROM csv_batches b
        INNER JOIN user_csv_purchases p ON p.batch_id = b.id
        WHERE b.id = ?
          AND p.user_id = ?
        LIMIT 1
      `,
      [batchId, userId]
    );

    if (!row) {
      return res.status(403).json({ success: false, error: '未购买该 CSV，不能下载' });
    }
    if (hashPurchaseToken(token) !== row.purchase_token_hash) {
      return res.status(403).json({ success: false, error: '购买凭证无效' });
    }

    const storagePath = path.resolve(row.storage_path);
    if (!storagePath.startsWith(CSV_STORAGE_DIR)) {
      return res.status(500).json({ success: false, error: 'CSV 存储路径非法' });
    }
    if (!fs.existsSync(storagePath)) {
      return res.status(404).json({ success: false, error: 'CSV 文件不存在' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.download(storagePath, row.file_name);
  } catch (error) {
    console.error('[csv-batches] download failed:', error);
    return res.status(500).json({
      success: false,
      error: '下载 CSV 失败',
      message: error.message
    });
  }
}

async function findAvailableBatchName(startDate, endDate) {
  const base = `blogs_${startDate}_${endDate}`;
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? '' : `_${String(index).padStart(4, '0')}`;
    const batchNo = `BLOGS_${startDate}_${endDate}${suffix}`;
    const fileName = `${base}${suffix}.csv`;
    const existing = await queryOne(
      `
        SELECT id
        FROM csv_batches
        WHERE batch_no = ?
           OR file_name = ?
        LIMIT 1
      `,
      [batchNo, fileName]
    );
    if (!existing) {
      return { batchNo, fileName };
    }
  }
  throw new Error(`无法为日期范围 ${startDate}-${endDate} 生成唯一 CSV 文件名`);
}

async function fetchExportRows(conn) {
  const [rows] = await conn.execute(
    `
      SELECT s.*
      FROM blog_run_stats s
      LEFT JOIN csv_batch_items i ON i.blog_run_stat_id = s.id
      WHERE i.id IS NULL
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT ?
    `,
    [EXPORT_BATCH_SIZE]
  );
  return rows;
}

async function exportOneBatch(conn) {
  const rows = await fetchExportRows(conn);
  if (rows.length < EXPORT_BATCH_SIZE) {
    return { created: false, rowCount: rows.length };
  }

  const startValue = rows[0].created_at;
  const endValue = rows[rows.length - 1].created_at;
  const sourceStartDate = formatDateOnly(startValue);
  const sourceEndDate = formatDateOnly(endValue);
  const { batchNo, fileName } = await findAvailableBatchName(
    formatDateCompact(startValue),
    formatDateCompact(endValue)
  );

  await fs.promises.mkdir(CSV_STORAGE_DIR, { recursive: true });
  const finalPath = path.join(CSV_STORAGE_DIR, fileName);
  const tempPath = path.join(CSV_STORAGE_DIR, `${fileName}.${process.pid}.${Date.now()}.tmp`);
  const csvContent = buildCsv(rows);
  const csvHash = sha256(csvContent);

  await fs.promises.writeFile(tempPath, csvContent, 'utf8');

  let batchId = null;
  try {
    await conn.beginTransaction();
    const [insertResult] = await conn.execute(
      `
        INSERT INTO csv_batches (
          batch_no,
          file_name,
          storage_path,
          sha256,
          row_count,
          source_start_date,
          source_end_date,
          source_started_at,
          source_ended_at,
          price,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'building', NOW(), NOW())
      `,
      [
        batchNo,
        fileName,
        finalPath,
        csvHash,
        rows.length,
        sourceStartDate,
        sourceEndDate,
        startValue,
        endValue,
        DEFAULT_BATCH_PRICE
      ]
    );
    batchId = insertResult.insertId;

    for (const row of rows) {
      await conn.execute(
        `
          INSERT INTO csv_batch_items (batch_id, blog_run_stat_id, created_at)
          VALUES (?, ?, NOW())
        `,
        [batchId, row.id]
      );
    }

    await conn.commit();
    await fs.promises.rename(tempPath, finalPath);
    await execute(
      `
        UPDATE csv_batches
        SET status = 'ready',
            updated_at = NOW()
        WHERE id = ?
      `,
      [batchId]
    );

    return { created: true, batchId, fileName, rowCount: rows.length };
  } catch (error) {
    await conn.rollback().catch(() => {});
    await fs.promises.unlink(tempPath).catch(() => {});
    if (batchId) {
      await execute(
        `
          UPDATE csv_batches
          SET status = 'failed',
              updated_at = NOW()
          WHERE id = ?
        `,
        [batchId]
      ).catch(() => {});
    }
    throw error;
  }
}

async function runExportJob(options = {}) {
  await ensureTables();
  await fs.promises.mkdir(CSV_STORAGE_DIR, { recursive: true });

  const maxBatches = Number(options.maxBatches || process.env.CSV_EXPORT_MAX_BATCHES_PER_RUN || 20);
  const conn = await getPool().getConnection();
  let lockAcquired = false;
  const result = {
    success: true,
    created: [],
    remainingRows: 0,
    lockSkipped: false
  };

  try {
    const [lockRows] = await conn.execute('SELECT GET_LOCK(?, 5) AS locked', [EXPORT_LOCK_NAME]);
    lockAcquired = !!(lockRows && lockRows[0] && Number(lockRows[0].locked) === 1);
    if (!lockAcquired) {
      result.lockSkipped = true;
      return result;
    }

    for (let index = 0; index < maxBatches; index += 1) {
      const batchResult = await exportOneBatch(conn);
      if (!batchResult.created) {
        result.remainingRows = batchResult.rowCount;
        break;
      }
      result.created.push(batchResult);
    }

    return result;
  } finally {
    if (lockAcquired) {
      await conn.execute('SELECT RELEASE_LOCK(?) AS released', [EXPORT_LOCK_NAME]).catch((error) => {
        console.error('[csv-batches] release export lock failed:', error);
      });
    }
    conn.release();
  }
}

async function grantDownloadAccessFromPaidOrder({ outTradeNo, alipayTradeNo, rawNotify }) {
  await ensureTables();
  const conn = await getPool().getConnection();

  try {
    await conn.beginTransaction();
    const [orderRows] = await conn.execute(
      `
        SELECT *
        FROM payment_orders
        WHERE out_trade_no = ?
        FOR UPDATE
      `,
      [outTradeNo]
    );
    const order = orderRows && orderRows[0];
    if (!order) {
      throw new Error(`订单不存在: ${outTradeNo}`);
    }
    if (!order.batch_id) {
      await conn.rollback();
      return { handled: false };
    }
    if (order.status === 'fulfilled') {
      await conn.commit();
      return { handled: true, alreadyGranted: true };
    }

    const [batchRows] = await conn.execute(
      `
        SELECT *
        FROM csv_batches
        WHERE id = ?
        FOR UPDATE
      `,
      [order.batch_id]
    );
    const batch = batchRows && batchRows[0];
    if (!batch) {
      throw new Error(`订单关联的 CSV 批次不存在: ${order.batch_id}`);
    }

    const token = createPurchaseToken({
      userId: order.user_id,
      batchId: order.batch_id,
      outTradeNo: order.out_trade_no
    });
    const tokenHash = hashPurchaseToken(token);

    await conn.execute(
      `
        INSERT INTO user_csv_purchases (
          user_id,
          batch_id,
          out_trade_no,
          purchase_token_hash,
          paid_at,
          granted_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          paid_at = COALESCE(paid_at, VALUES(paid_at)),
          granted_at = COALESCE(granted_at, VALUES(granted_at)),
          updated_at = NOW()
      `,
      [order.user_id, order.batch_id, order.out_trade_no, tokenHash]
    );

    await conn.execute(
      `
        UPDATE payment_orders
        SET status = 'fulfilled',
            alipay_trade_no = ?,
            paid_at = COALESCE(paid_at, NOW()),
            fulfilled_at = COALESCE(fulfilled_at, NOW()),
            raw_notify = ?,
            updated_at = NOW()
        WHERE out_trade_no = ?
      `,
      [alipayTradeNo || null, rawNotify, outTradeNo]
    );

    await conn.commit();
    return { handled: true, token };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

function getDelayUntilNextRun() {
  const now = new Date();
  const hongKongNow = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const next = new Date(hongKongNow);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= hongKongNow) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return Math.max(60 * 1000, next.getTime() - hongKongNow.getTime());
}

function scheduleNextExport() {
  const delay = getDelayUntilNextRun();
  schedulerTimer = setTimeout(async () => {
    try {
      const result = await runExportJob();
      console.info('[csv-batches] scheduled export finished:', result);
    } catch (error) {
      console.error('[csv-batches] scheduled export failed:', error);
    } finally {
      scheduleNextExport();
    }
  }, delay);
  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }
}

function startScheduler() {
  if (schedulerStarted || String(process.env.CSV_EXPORT_SCHEDULER || 'on').toLowerCase() === 'off') {
    return;
  }
  schedulerStarted = true;
  scheduleNextExport();
}

router.get('/csv-batches', listBatches);
router.get('/csv-batches/:batchId/download', downloadBatch);

router.ensureTables = ensureTables;
router.getBatchById = getBatchById;
router.getReadyBatchForPurchase = getReadyBatchForPurchase;
router.findUserPurchase = findUserPurchase;
router.buildPaymentProduct = buildPaymentProduct;
router.grantDownloadAccessFromPaidOrder = grantDownloadAccessFromPaidOrder;
router.runExportJob = runExportJob;
router.startScheduler = startScheduler;
router.CSV_BATCH_PLAN_ID = CSV_BATCH_PLAN_ID;

module.exports = router;
