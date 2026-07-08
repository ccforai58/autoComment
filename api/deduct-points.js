const express = require('express');
const router = express.Router();

const { queryOne } = require('./db');

const USER_NOT_FOUND_RESPONSE = {
  success: false,
  code: 'USER_NOT_FOUND',
  error: 'User ID must be manually assigned by an administrator'
};

/**
 * Local-only mode: points consumption is disabled.
 * POST /api/deduct-points
 * Body: { userId: string, points: number }
 */
router.post('/deduct-points', async (req, res) => {
  const { userId, points } = req.body || {};

  if (!userId || points === undefined) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_REQUIRED_PARAMS',
      error: 'Missing required parameters'
    });
  }

  const pointsToDeduct = Number(points);
  if (!Number.isInteger(pointsToDeduct) || pointsToDeduct <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_POINTS',
      error: 'points must be a positive integer'
    });
  }

  try {
    const row = await queryOne('SELECT points FROM auto_comment_users WHERE user_id = ?', [userId]);
    if (!row) {
      return res.status(404).json(USER_NOT_FOUND_RESPONSE);
    }

    return res.status(200).json({
      success: true,
      deductedPoints: 0,
      requestedPoints: pointsToDeduct,
      remainingPoints: Number(row.points) || 0,
      pointsDisabled: true
    });
  } catch (err) {
    console.error('[deduct-points] database operation failed:', err.message);
    return res.status(500).json({
      success: false,
      code: 'DATABASE_ERROR',
      error: 'Database operation failed',
      message: err.message
    });
  }
});

module.exports = router;
