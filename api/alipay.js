const express = require('express');
const { AlipaySdk } = require('alipay-sdk');

const { execute, getPool, query, queryOne } = require('./db');

const router = express.Router();

const ACTIVE_ORDER_STATUSES = ['pending_payment', 'paid_pending_fulfillment'];
const PAID_TRADE_STATUSES = ['TRADE_SUCCESS', 'TRADE_FINISHED'];

const PLANS = {
  blog_250: {
    id: 'blog_250',
    name: '博客列表基础包',
    amount: '19.90',
    subject: 'AutoComment 博客列表基础包',
    body: '250条博客列表，最终转化率5%~10%'
  },
  as_50: {
    id: 'as_50',
    name: '高 AS 博客精选包',
    amount: '19.90',
    subject: 'AutoComment 高 AS 博客精选包',
    body: '50条 AS评分>50 的博客列表'
  }
};

const STATUS_TEXT = {
  none: '未购买',
  pending_payment: '待支付',
  paid_pending_fulfillment: '已支付，待人工发货',
  fulfilled: '已发货',
  closed: '已关闭',
  failed: '异常或失败'
};

let tablesReadyPromise = null;
let sdkInstance = null;
let sdkConfigFingerprint = '';

function getAlipayEnv() {
  return String(process.env.ALIPAY_ENV || 'sandbox').trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
}

function getGateway() {
  if (process.env.ALIPAY_GATEWAY) {
    return process.env.ALIPAY_GATEWAY;
  }
  return getAlipayEnv() === 'production'
    ? 'https://openapi.alipay.com/gateway.do'
    : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
}

function wrapPem(value, type) {
  const raw = String(value || '').replace(/\\n/g, '\n').trim();
  if (!raw) return '';
  if (raw.includes('-----BEGIN')) return raw;

  const compact = raw.replace(/\s+/g, '');
  const lines = compact.match(/.{1,64}/g) || [];
  return [
    `-----BEGIN ${type}-----`,
    ...lines,
    `-----END ${type}-----`
  ].join('\n');
}

function normalizePrivateKey(value, keyType) {
  return wrapPem(value, keyType === 'PKCS1' ? 'RSA PRIVATE KEY' : 'PRIVATE KEY');
}

function normalizePublicKey(value) {
  return wrapPem(value, 'PUBLIC KEY');
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function getReturnUrl() {
  return process.env.ALIPAY_RETURN_URL || 'https://jieyunsang.cn/api/alipay/return';
}

function getNotifyUrl() {
  return process.env.ALIPAY_NOTIFY_URL || 'https://jieyunsang.cn/api/alipay/notify';
}

function getSdk() {
  const appId = getRequiredEnv('ALIPAY_APP_ID');
  const keyType = String(process.env.ALIPAY_KEY_TYPE || 'PKCS8').trim().toUpperCase() === 'PKCS1'
    ? 'PKCS1'
    : 'PKCS8';
  const privateKey = normalizePrivateKey(getRequiredEnv('ALIPAY_PRIVATE_KEY'), keyType);
  const alipayPublicKey = normalizePublicKey(getRequiredEnv('ALIPAY_PUBLIC_KEY'));
  const gateway = getGateway();

  const fingerprint = JSON.stringify({
    appId,
    privateKey,
    alipayPublicKey,
    gateway,
    keyType
  });

  if (!sdkInstance || sdkConfigFingerprint !== fingerprint) {
    sdkInstance = new AlipaySdk({
      appId,
      privateKey,
      alipayPublicKey,
      gateway,
      keyType,
      signType: 'RSA2',
      charset: 'utf-8'
    });
    sdkConfigFingerprint = fingerprint;
  }

  return sdkInstance;
}

async function ensureTables() {
  if (!tablesReadyPromise) {
    tablesReadyPromise = execute(
      `
        CREATE TABLE IF NOT EXISTS payment_orders (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          out_trade_no VARCHAR(64) NOT NULL,
          alipay_trade_no VARCHAR(128) DEFAULT NULL,
          user_id VARCHAR(255) NOT NULL,
          plan_id VARCHAR(64) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'pending_payment',
          paid_at TIMESTAMP NULL DEFAULT NULL,
          fulfilled_at TIMESTAMP NULL DEFAULT NULL,
          raw_notify JSON DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_payment_orders_out_trade_no (out_trade_no),
          INDEX idx_payment_orders_user_status (user_id, status),
          INDEX idx_payment_orders_user_created (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `,
      []
    ).catch((error) => {
      tablesReadyPromise = null;
      throw error;
    });
  }
  return tablesReadyPromise;
}

function generateOutTradeNo() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AC${timestamp}${random}`;
}

function getPlan(planId) {
  return PLANS[planId] || null;
}

function formatDate(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function buildPurchaseStatus(row) {
  if (!row) {
    return {
      success: true,
      status: 'none',
      statusText: STATUS_TEXT.none
    };
  }

  const plan = getPlan(row.plan_id);
  return {
    success: true,
    status: row.status,
    statusText: STATUS_TEXT[row.status] || row.status,
    planId: row.plan_id,
    planName: plan ? plan.name : row.plan_id,
    outTradeNo: row.out_trade_no,
    paidAt: formatDate(row.paid_at),
    fulfilledAt: formatDate(row.fulfilled_at),
    createdAt: formatDate(row.created_at)
  };
}

async function findActiveOrder(userId) {
  return queryOne(
    `
      SELECT *
      FROM payment_orders
      WHERE user_id = ?
        AND status IN (?, ?)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId, ACTIVE_ORDER_STATUSES[0], ACTIVE_ORDER_STATUSES[1]]
  );
}

async function findLatestOrder(userId) {
  return queryOne(
    `
      SELECT *
      FROM payment_orders
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );
}

function getActiveOrderError(order) {
  if (!order) return null;
  if (order.status === 'paid_pending_fulfillment') {
    return {
      code: 'PENDING_FULFILLMENT_EXISTS',
      message: '你已有已支付订单，正在等待人工发货'
    };
  }
  return {
    code: 'ACTIVE_ORDER_EXISTS',
    message: '你有一笔待支付订单，请先完成或等待订单关闭'
  };
}

function buildPayUrl({ outTradeNo, plan }) {
  const sdk = getSdk();
  return sdk.pageExecute('alipay.trade.page.pay', 'GET', {
    notifyUrl: getNotifyUrl(),
    returnUrl: getReturnUrl(),
    bizContent: {
      out_trade_no: outTradeNo,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: plan.amount,
      subject: plan.subject,
      body: plan.body
    }
  });
}

async function createOrder(req, res) {
  const { userId, planId } = req.body || {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: '缺少 userId 参数' });
  }

  const normalizedUserId = userId.trim();
  const plan = getPlan(planId);
  if (!plan) {
    return res.status(400).json({ success: false, error: '无效的套餐' });
  }

  let conn = null;
  let lockName = '';
  let lockAcquired = false;

  try {
    await ensureTables();

    conn = await getPool().getConnection();
    lockName = `payment_order:${normalizedUserId}`;
    const [lockRows] = await conn.execute('SELECT GET_LOCK(?, 5) AS locked', [lockName]);
    const lockRow = lockRows && lockRows[0];
    lockAcquired = !!(lockRow && Number(lockRow.locked) === 1);
    if (!lockAcquired) {
      return res.status(429).json({
        success: false,
        code: 'ORDER_LOCK_TIMEOUT',
        message: '订单创建处理中，请稍后重试'
      });
    }

    const [activeRows] = await conn.execute(
      `
        SELECT *
        FROM payment_orders
        WHERE user_id = ?
          AND status IN (?, ?)
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [normalizedUserId, ACTIVE_ORDER_STATUSES[0], ACTIVE_ORDER_STATUSES[1]]
    );
    const activeOrder = activeRows && activeRows[0];
    const activeOrderError = getActiveOrderError(activeOrder);
    if (activeOrderError) {
      return res.status(409).json({
        success: false,
        ...activeOrderError,
        order: activeOrder ? buildPurchaseStatus(activeOrder) : null
      });
    }

    const outTradeNo = generateOutTradeNo();
    const payUrl = buildPayUrl({ outTradeNo, plan });

    await conn.execute(
      `
        INSERT INTO payment_orders
          (out_trade_no, user_id, plan_id, subject, amount, status, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, 'pending_payment', NOW(), NOW())
      `,
      [outTradeNo, normalizedUserId, plan.id, plan.subject, plan.amount]
    );

    return res.status(200).json({
      success: true,
      outTradeNo,
      payUrl,
      env: getAlipayEnv(),
      plan: {
        id: plan.id,
        name: plan.name,
        amount: plan.amount
      }
    });
  } catch (error) {
    console.error('[alipay] create-order failed:', error);
    return res.status(500).json({
      success: false,
      error: '创建支付宝订单失败',
      message: error.message
    });
  } finally {
    if (conn && lockAcquired && lockName) {
      await conn.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]).catch((error) => {
        console.error('[alipay] release order lock failed:', error);
      });
    }
    if (conn) {
      conn.release();
    }
  }
}

function normalizeNotifyBody(body) {
  const normalized = {};
  Object.keys(body || {}).forEach((key) => {
    const value = body[key];
    normalized[key] = Array.isArray(value) ? value[0] : value;
  });
  return normalized;
}

async function handleNotify(req, res) {
  const notifyData = normalizeNotifyBody(req.body);

  try {
    await ensureTables();

    const sdk = getSdk();
    const signOk = sdk.checkNotifySignV2(notifyData);
    if (!signOk) {
      console.warn('[alipay] notify sign check failed:', notifyData);
      return res.status(400).send('failure');
    }

    const outTradeNo = notifyData.out_trade_no;
    const order = await queryOne('SELECT * FROM payment_orders WHERE out_trade_no = ?', [outTradeNo]);
    if (!order) {
      console.warn('[alipay] notify order not found:', outTradeNo);
      return res.status(404).send('failure');
    }

    if (notifyData.app_id && notifyData.app_id !== process.env.ALIPAY_APP_ID) {
      console.warn('[alipay] notify app_id mismatch:', notifyData.app_id);
      return res.status(400).send('failure');
    }

    const notifyAmount = Number(notifyData.total_amount);
    const orderAmount = Number(order.amount);
    if (!Number.isFinite(notifyAmount) || Math.abs(notifyAmount - orderAmount) > 0.001) {
      console.warn('[alipay] notify amount mismatch:', {
        outTradeNo,
        notifyAmount,
        orderAmount
      });
      return res.status(400).send('failure');
    }

    const tradeStatus = notifyData.trade_status;
    const rawNotify = JSON.stringify(notifyData);
    if (PAID_TRADE_STATUSES.includes(tradeStatus)) {
      await execute(
        `
          UPDATE payment_orders
          SET status = CASE
                WHEN status = 'fulfilled' THEN status
                ELSE 'paid_pending_fulfillment'
              END,
              alipay_trade_no = ?,
              paid_at = COALESCE(paid_at, NOW()),
              raw_notify = ?,
              updated_at = NOW()
          WHERE out_trade_no = ?
        `,
        [notifyData.trade_no || null, rawNotify, outTradeNo]
      );
      return res.status(200).send('success');
    }

    if (tradeStatus === 'TRADE_CLOSED') {
      await execute(
        `
          UPDATE payment_orders
          SET status = CASE
                WHEN status IN ('pending_payment', 'failed') THEN 'closed'
                ELSE status
              END,
              alipay_trade_no = ?,
              raw_notify = ?,
              updated_at = NOW()
          WHERE out_trade_no = ?
        `,
        [notifyData.trade_no || null, rawNotify, outTradeNo]
      );
      return res.status(200).send('success');
    }

    await execute(
      `
        UPDATE payment_orders
        SET raw_notify = ?,
            updated_at = NOW()
        WHERE out_trade_no = ?
      `,
      [rawNotify, outTradeNo]
    );

    return res.status(200).send('success');
  } catch (error) {
    console.error('[alipay] notify failed:', error);
    return res.status(500).send('failure');
  }
}

async function purchaseStatus(req, res) {
  const { userId } = req.query || {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: '缺少 userId 参数' });
  }

  try {
    await ensureTables();
    const latestOrder = await findLatestOrder(userId.trim());
    return res.status(200).json(buildPurchaseStatus(latestOrder));
  } catch (error) {
    console.error('[alipay] purchase-status failed:', error);
    return res.status(500).json({
      success: false,
      error: '查询套餐状态失败',
      message: error.message
    });
  }
}

async function listOrders(req, res) {
  const { userId } = req.query || {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: '缺少 userId 参数' });
  }

  try {
    await ensureTables();
    const rows = await query(
      `
        SELECT *
        FROM payment_orders
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [userId.trim()]
    );
    return res.status(200).json({
      success: true,
      orders: rows.map((row) => buildPurchaseStatus(row))
    });
  } catch (error) {
    console.error('[alipay] orders failed:', error);
    return res.status(500).json({
      success: false,
      error: '查询订单失败',
      message: error.message
    });
  }
}

function returnPage(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>支付结果 - AutoComment</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f5f7;
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        width: min(420px, calc(100vw - 32px));
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0; color: #4b5563; line-height: 1.7; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>支付结果处理中</h1>
      <p>支付宝已返回支付页面。订单是否成功以服务器异步通知为准，请回到插件设置页查看套餐状态。</p>
    </div>
  </body>
</html>`);
}

router.post('/alipay/create-order', createOrder);
router.post('/alipay/notify', handleNotify);
router.get('/alipay/return', returnPage);
router.get('/purchase-status', purchaseStatus);
router.get('/alipay/orders', listOrders);

router.ensureTables = ensureTables;
router.PLANS = PLANS;
router.STATUS_TEXT = STATUS_TEXT;

module.exports = router;
