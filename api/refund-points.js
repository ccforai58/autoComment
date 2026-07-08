const express = require('express');
const router = express.Router();

const { queryOne } = require('./db');

const USER_NOT_FOUND_RESPONSE = {
  success: false,
  code: 'USER_NOT_FOUND',
  error: 'User ID must be manually assigned by an administrator'
};

/**
 * Local-only mode: points consumption is disabled, so refunds are no-ops.
 * POST /api/refund-points
 * Body: { userId, batchId, url, reason }
 */
router.post('/refund-points', async (req, res) => {
  const { userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_USER_ID',
      error: 'Missing userId'
    });
  }

  try {
    const row = await queryOne('SELECT points FROM auto_comment_users WHERE user_id = ?', [userId]);
    if (!row) {
      return res.status(404).json(USER_NOT_FOUND_RESPONSE);
    }

    return res.status(200).json({
      success: true,
      refundedPoints: 0,
      remainingPoints: Number(row.points) || 0,
      pointsDisabled: true
    });
  } catch (err) {
    console.error('[refund-points] error:', err.message);
    return res.status(500).json({
      success: false,
      code: 'DATABASE_ERROR',
      error: 'Internal server error',
      message: err.message
    });
  }
});

module.exports = router;
