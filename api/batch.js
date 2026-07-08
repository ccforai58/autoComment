const express = require('express');

const { execute } = require('./db');

const router = express.Router();

let tablesReadyPromise = null;

async function ensureTables() {
  if (!tablesReadyPromise) {
    tablesReadyPromise = execute(
      `
        CREATE TABLE IF NOT EXISTS batch_reports (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          batch_id VARCHAR(64) NOT NULL,
          url_index INT NOT NULL,
          page_url TEXT DEFAULT NULL,
          result VARCHAR(40) NOT NULL,
          ai_content MEDIUMTEXT DEFAULT NULL,
          error_message TEXT DEFAULT NULL,
          raw_payload JSON DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_batch_reports_batch_url_index (batch_id, url_index),
          INDEX idx_batch_reports_batch_result (batch_id, result)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `,
      []
    ).then(() => {
      console.info('[batch-report] batch_reports table ready');
    }).catch((error) => {
      tablesReadyPromise = null;
      throw error;
    });
  }
  return tablesReadyPromise;
}

function normalizeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

router.post('/batch/:batchId/report', async (req, res) => {
  const batchId = String(req.params.batchId || '').trim();
  const body = req.body || {};
  const urlIndex = normalizeInteger(body.urlIndex);
  const result = String(body.result || '').trim();
  const pageUrl = String(body.url || body.pageUrl || '').trim();
  const aiContent = body.aiContent == null ? null : String(body.aiContent);
  const errorMessage = body.errorMessage == null ? null : String(body.errorMessage);

  if (!batchId || urlIndex === null || !result) {
    return res.status(400).json({
      success: false,
      error: 'batchId, urlIndex and result are required'
    });
  }

  try {
    await ensureTables();
    await execute(
      `
        INSERT INTO batch_reports (
          batch_id,
          url_index,
          page_url,
          result,
          ai_content,
          error_message,
          raw_payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          page_url = VALUES(page_url),
          result = VALUES(result),
          ai_content = VALUES(ai_content),
          error_message = VALUES(error_message),
          raw_payload = VALUES(raw_payload),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        batchId,
        urlIndex,
        pageUrl || null,
        result,
        aiContent,
        errorMessage,
        JSON.stringify(body)
      ]
    );

    console.info('[batch-report] saved', {
      batchId,
      urlIndex,
      result,
      pageUrl
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[batch-report] save failed:', error);
    return res.status(500).json({
      success: false,
      error: 'BATCH_REPORT_SAVE_FAILED',
      message: error.message
    });
  }
});

router.ensureTables = ensureTables;

module.exports = router;
