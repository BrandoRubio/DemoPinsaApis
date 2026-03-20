const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET sensors (optionally filtered by device_id)
router.get('/sensors', authenticateToken, async (req, res) => {
  const { device_id } = req.query;
  try {
    let query = `
      SELECT s.sensor_id, s.device_id, d.name AS device_name,
             s.var, s.title, s.icon, s.unit, s.is_active,
             s.created_at, s.updated_at
      FROM sensors s
      JOIN devices d ON d.device_id = s.device_id
      WHERE s.is_active = TRUE
    `;
    const params = [];
    if (device_id) {
      params.push(device_id);
      query += ` AND s.device_id = $${params.length}`;
    }
    query += ` ORDER BY s.title ASC`;

    const result = await pool.query(query, params);
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching sensors:', e);
    res.status(500).json({ error: true, message: 'Error fetching sensors', data: [] });
  }
});

// GET single sensor
router.get('/sensors/:sensor_id', authenticateToken, async (req, res) => {
  const { sensor_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT s.sensor_id, s.device_id, d.name AS device_name,
              s.var, s.title, s.icon, s.unit, s.is_active,
              s.created_at, s.updated_at
       FROM sensors s
       JOIN devices d ON d.device_id = s.device_id
       WHERE s.sensor_id = $1`,
      [sensor_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Sensor not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching sensor:', e);
    res.status(500).json({ error: true, message: 'Error fetching sensor', data: [] });
  }
});

// POST create one or multiple sensors
// Body: { device_id, sensors: [{ var, title, icon, unit }] }
// or single: { device_id, var, title, icon, unit }
router.post('/sensors', authenticateToken, async (req, res) => {
  const created_by = req.user?.user_id || null;
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: true, message: 'device_id is required' });
  }

  // Normalize: accept single object or array
  let sensorsToInsert = [];
  if (Array.isArray(req.body.sensors)) {
    sensorsToInsert = req.body.sensors;
  } else {
    const { var: varCode, title, icon, unit } = req.body;
    if (!varCode || !title) {
      return res.status(400).json({ error: true, message: 'var and title are required' });
    }
    sensorsToInsert = [{ var: varCode, title, icon, unit }];
  }

  if (sensorsToInsert.length === 0) {
    return res.status(400).json({ error: true, message: 'sensors array is empty' });
  }

  // Validate each item
  for (const s of sensorsToInsert) {
    if (!s.var || !s.title) {
      return res.status(400).json({ error: true, message: 'Each sensor requires var and title' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inserted = [];
    for (const s of sensorsToInsert) {
      const result = await client.query(
        `INSERT INTO sensors (device_id, var, title, icon, unit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING sensor_id, var, title`,
        [device_id, s.var, s.title, s.icon || null, s.unit || null, created_by]
      );
      if (result.rowCount > 0) {
        inserted.push(result.rows[0]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      error: false,
      message: 'ok',
      inserted_count: inserted.length,
      sensors: inserted
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error creating sensors:', e);
    res.status(500).json({ error: true, message: 'Error creating sensors' });
  } finally {
    client.release();
  }
});

// PUT update sensor
router.put('/sensors/:sensor_id', authenticateToken, async (req, res) => {
  const { sensor_id } = req.params;
  const { device_id, var: varCode, title, icon, unit, is_active } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE sensors
       SET device_id = $1, var = $2, title = $3, icon = $4,
           unit = $5, is_active = $6, updated_by = $7
       WHERE sensor_id = $8
       RETURNING sensor_id`,
      [device_id, varCode, title, icon, unit, is_active, updated_by, sensor_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Sensor not found' });
    }
    res.json({ error: false, message: 'ok', sensor_id: result.rows[0].sensor_id });
  } catch (e) {
    console.error('Error updating sensor:', e);
    res.status(500).json({ error: true, message: 'Error updating sensor' });
  }
});

// DELETE sensor
router.delete('/sensors/:sensor_id', authenticateToken, async (req, res) => {
  const { sensor_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM sensors WHERE sensor_id = $1 RETURNING sensor_id`,
      [sensor_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Sensor not found' });
    }
    res.json({ error: false, message: 'ok', sensor_id: result.rows[0].sensor_id });
  } catch (e) {
    console.error('Error deleting sensor:', e);
    res.status(500).json({ error: true, message: 'Error deleting sensor' });
  }
});

module.exports = router;