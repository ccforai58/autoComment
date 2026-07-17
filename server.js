require('dotenv').config();

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const ENABLE_PAYMENT = String(process.env.ENABLE_PAYMENT || 'false').toLowerCase() === 'true';

require('./api/db');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

const blogRunStatsHandler = require('./api/blog-run-stats');
const batchRouter = require('./api/batch');
const linkAssistantRouter = require('./api/link-assistant');
const csvBatchesRouter = ENABLE_PAYMENT ? require('./api/csv-batches') : null;
const alipayRouter = ENABLE_PAYMENT ? require('./api/alipay') : null;
const generateCopyHandler = require('./api/generate-copy');

app.post('/api/generate-copy', generateCopyHandler);
app.post('/api/generate-copy/cancel', generateCopyHandler.cancel);
app.post('/api/blog-run-stats', blogRunStatsHandler);
app.use('/api', require('./api/get-points'));
app.use('/api', require('./api/deduct-points'));
app.use('/api', require('./api/refund-points'));
app.use('/api', batchRouter);
app.use('/api', require('./api/debug-log'));
app.use('/api', require('./api/local-status'));
app.use('/api', require('./api/semrush-domain-review'));
app.use('/api', require('./api/backlink-check'));
app.use('/api', linkAssistantRouter);

if (ENABLE_PAYMENT) {
  app.use('/api', csvBatchesRouter);
  app.use('/api', alipayRouter);
} else {
  console.info('[Server] payment/csv purchase modules disabled (ENABLE_PAYMENT=false)');
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(express.static(__dirname, {
  dotfiles: 'ignore',
  index: 'index.html'
}));

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`[Server] local backend listening on port ${PORT}`);
  console.info('[Server] ENABLE_PAYMENT =', ENABLE_PAYMENT);

  blogRunStatsHandler.ensureTable().catch((err) => {
    console.error('[Server] blog_run_stats table init failed:', err);
  });

  batchRouter.ensureTables().catch((err) => {
    console.error('[Server] batch_reports table init failed:', err);
  });

  linkAssistantRouter.ensureTables().catch((err) => {
    console.error('[Server] link assistant tables init failed:', err);
  });

  if (ENABLE_PAYMENT) {
    alipayRouter.logConfigDiagnostics();
    alipayRouter.ensureTables().catch((err) => {
      console.error('[Server] payment_orders table init failed:', err);
    });
    csvBatchesRouter.ensureTables().catch((err) => {
      console.error('[Server] csv batch tables init failed:', err);
    });
    csvBatchesRouter.startScheduler();
  }
});
