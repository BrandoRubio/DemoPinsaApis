const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET widgets (optionally filtered by dashboard_id)
router.get('/widgets', authenticateToken, async (req, res) => {
  const { dashboard_id } = req.query;
  try {
    let query = `
      SELECT w.widget_id, w.dashboard_id, w.dashboard_group_id,
             w.name, w.index, w.col_size, w.date_range,
             w.color, w.border_flag, w.parameters,
             w.created_at, w.updated_at
      FROM widgets w
    `;
    const params = [];
    if (dashboard_id) {
      params.push(dashboard_id);
      query += ` WHERE w.dashboard_id = $${params.length}`;
    }
    query += ` ORDER BY w.index ASC`;

    const result = await pool.query(query, params);
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching widgets:', e);
    res.status(500).json({ error: true, message: 'Error fetching widgets', data: [] });
  }
});

// GET single widget
router.get('/widgets/:widget_id', authenticateToken, async (req, res) => {
  const { widget_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT widget_id, dashboard_id, dashboard_group_id,
              name, index, col_size, date_range,
              color, border_flag, parameters,
              created_at, updated_at
       FROM widgets WHERE widget_id = $1`,
      [widget_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Widget not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching widget:', e);
    res.status(500).json({ error: true, message: 'Error fetching widget', data: [] });
  }
});

router.post('/widgets', authenticateToken, async (req, res) => {
  const { dashboard_group_id, name, color, border_flag, parameters, index, dateRange } = req.body;
  const created_by = req.user?.user_id || null;

  if (!dashboard_group_id) {
    return res.status(400).json({ error: true, message: 'dashboard_group_id is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO widgets
         (dashboard_id, dashboard_group_id, name, color, border_flag, parameters, index, date_range, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $9)
       RETURNING widget_id`,
      [dashboard_group_id, dashboard_group_id, name, color, border_flag, parameters, index ?? 0, dateRange, created_by]
    );

    res.status(201).json({
      error:     false,
      message:   'ok',
      widget_id: result.rows[0].widget_id
    });
  } catch (e) {
    console.error('Error creating widget:', e);
    res.status(500).json({ error: true, message: 'Error creating widget' });
  }
});

// PUT full update widget
router.put('/widgets/:widget_id', authenticateToken, async (req, res) => {
  const { widget_id } = req.params;
  const { dashboard_id, dashboard_group_id, name, index, col_size, date_range, color, border_flag, parameters } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE widgets
       SET dashboard_id = $1, dashboard_group_id = $2, name = $3, index = $4,
           col_size = $5, date_range = $6, color = $7, border_flag = $8,
           parameters = $9, updated_by = $10
       WHERE widget_id = $11
       RETURNING widget_id`,
      [dashboard_id, dashboard_group_id, name, index, col_size, date_range, color, border_flag, parameters, updated_by, widget_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Widget not found' });
    }
    res.json({ error: false, message: 'ok', widget_id: result.rows[0].widget_id });
  } catch (e) {
    console.error('Error updating widget:', e);
    res.status(500).json({ error: true, message: 'Error updating widget' });
  }
});

// PATCH update layout only — col_size, date_range
router.patch('/widgets/:widget_id/layout', authenticateToken, async (req, res) => {
  const { widget_id } = req.params;
  const { col_size, date_range } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE widgets
       SET col_size = $1, date_range = $2, updated_by = $3
       WHERE widget_id = $4
       RETURNING widget_id`,
      [col_size, date_range, updated_by, widget_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Widget not found' });
    }
    res.json({ error: false, message: 'ok', widget_id: result.rows[0].widget_id });
  } catch (e) {
    console.error('Error updating widget layout:', e);
    res.status(500).json({ error: true, message: 'Error updating widget layout' });
  }
});

// PATCH update appearance — name, border_flag, color, parameters
router.patch('/widgets/:widget_id/appearance', authenticateToken, async (req, res) => {
  const { widget_id } = req.params;
  const { name, border_flag, color, parameters } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE widgets
       SET name = $1, border_flag = $2, color = $3, parameters = $4, updated_by = $5
       WHERE widget_id = $6
       RETURNING widget_id`,
      [name, border_flag, color, parameters, updated_by, widget_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Widget not found' });
    }
    res.json({ error: false, message: 'ok', widget_id: result.rows[0].widget_id });
  } catch (e) {
    console.error('Error updating widget appearance:', e);
    res.status(500).json({ error: true, message: 'Error updating widget appearance' });
  }
});

// DELETE widget
router.delete('/widgets/:widget_id', authenticateToken, async (req, res) => {
  const { widget_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM widgets WHERE widget_id = $1 RETURNING widget_id`,
      [widget_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Widget not found' });
    }
    res.json({ error: false, message: 'ok', widget_id: result.rows[0].widget_id });
  } catch (e) {
    console.error('Error deleting widget:', e);
    res.status(500).json({ error: true, message: 'Error deleting widget' });
  }
});

module.exports = router;