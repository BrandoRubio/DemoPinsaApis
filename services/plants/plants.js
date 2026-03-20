const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET plants (optionally filtered by park_id)
router.get('/plants', authenticateToken, async (req, res) => {
  const { park_id } = req.query;
  try {
    let query = `
      SELECT pl.plant_id, pl.park_id, pk.name AS park_name,
             pl.name, pl.description, pl.latitude, pl.longitude,
             pl.address, pl.timezone, pl.is_active, pl.created_at, pl.updated_at
      FROM plants pl
      JOIN parks pk ON pk.park_id = pl.park_id
      WHERE pl.is_active = TRUE
    `;
    const params = [];
    if (park_id) {
      params.push(park_id);
      query += ` AND pl.park_id = $${params.length}`;
    }
    query += ` ORDER BY pl.name ASC`;

    const result = await pool.query(query, params);
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching plants:', e);
    res.status(500).json({ error: true, message: 'Error fetching plants', data: [] });
  }
});

// GET single plant
router.get('/plants/:plant_id', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT pl.plant_id, pl.park_id, pk.name AS park_name,
              pl.name, pl.description, pl.latitude, pl.longitude,
              pl.address, pl.timezone, pl.is_active, pl.created_at, pl.updated_at
       FROM plants pl
       JOIN parks pk ON pk.park_id = pl.park_id
       WHERE pl.plant_id = $1`,
      [plant_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Plant not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching plant:', e);
    res.status(500).json({ error: true, message: 'Error fetching plant', data: [] });
  }
});

// POST create plant
router.post('/plants', authenticateToken, async (req, res) => {
  const { park_id, name, description, latitude, longitude, address, timezone } = req.body;
  const created_by = req.user?.user_id || null;

  if (!park_id || !name) {
    return res.status(400).json({ error: true, message: 'park_id and name are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO plants (park_id, name, description, latitude, longitude, address, timezone, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING plant_id`,
      [park_id, name, description, latitude, longitude, address, timezone, created_by]
    );
    res.status(201).json({ error: false, message: 'ok', plant_id: result.rows[0].plant_id });
  } catch (e) {
    console.error('Error creating plant:', e);
    res.status(500).json({ error: true, message: 'Error creating plant' });
  }
});

// PUT update plant
router.put('/plants/:plant_id', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  const { park_id, name, description, latitude, longitude, address, timezone, is_active } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE plants
       SET park_id = $1, name = $2, description = $3, latitude = $4, longitude = $5,
           address = $6, timezone = $7, is_active = $8, updated_by = $9
       WHERE plant_id = $10
       RETURNING plant_id`,
      [park_id, name, description, latitude, longitude, address, timezone, is_active, updated_by, plant_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Plant not found' });
    }
    res.json({ error: false, message: 'ok', plant_id: result.rows[0].plant_id });
  } catch (e) {
    console.error('Error updating plant:', e);
    res.status(500).json({ error: true, message: 'Error updating plant' });
  }
});

// DELETE plant
router.delete('/plants/:plant_id', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM plants WHERE plant_id = $1 RETURNING plant_id`,
      [plant_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Plant not found' });
    }
    res.json({ error: false, message: 'ok', plant_id: result.rows[0].plant_id });
  } catch (e) {
    console.error('Error deleting plant:', e);
    res.status(500).json({ error: true, message: 'Error deleting plant' });
  }
});

module.exports = router;