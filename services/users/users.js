const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET single user
router.get('/users/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT user_id, name, email, is_active, created_at, updated_at
       FROM users WHERE user_id = $1`,
      [user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'User not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching user:', e);
    res.status(500).json({ error: true, message: 'Error fetching user', data: [] });
  }
});
router.get('/plant/:plant_id/users', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         u.user_id, u.name, u.email, u.is_active,
         json_agg(DISTINCT jsonb_build_object('park_id', pa.park_id, 'name', pk.name))
           FILTER (WHERE pa.park_id IS NOT NULL) AS parks,
         json_agg(DISTINCT jsonb_build_object('plant_id', pla.plant_id, 'name', pl.name))
           FILTER (WHERE pla.plant_id IS NOT NULL) AS plants,
         COALESCE(pla2.role, pa2.role, 'viewer') AS role
       FROM users u
       LEFT JOIN park_access  pa  ON pa.user_id  = u.user_id
       LEFT JOIN parks        pk  ON pk.park_id  = pa.park_id
       LEFT JOIN plant_access pla ON pla.user_id = u.user_id
       LEFT JOIN plants       pl  ON pl.plant_id = pla.plant_id
       LEFT JOIN plant_access pla2 ON pla2.user_id = u.user_id AND pla2.plant_id = $1
       LEFT JOIN park_access  pa2  ON pa2.user_id  = u.user_id
       WHERE pla.plant_id = $1 OR pa.park_id IN (
         SELECT park_id FROM plants WHERE plant_id = $1
       )
       GROUP BY u.user_id, u.name, u.email, u.is_active, pla2.role, pa2.role`,
      [plant_id]
    );
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching plant users:', e);
    res.status(500).json({ error: true, message: 'Error fetching plant users', data: [] });
  }
});
// POST create user
router.post('/users', authenticateToken, async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: true, message: 'name, email and password are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id`,
      [name, email, password, role]
    );
    res.status(201).json({ error: false, message: 'ok', user_id: result.rows[0].user_id });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: true, message: 'Email already exists' });
    }
    console.error('Error creating user:', e);
    res.status(500).json({ error: true, message: 'Error creating user' });
  }
});

// PUT update user
router.put('/users/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  const { name, email, password, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users
       SET name = $1, email = $2, password = $3, is_active = $4
       WHERE user_id = $5
       RETURNING user_id`,
      [name, email, password, is_active, user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'User not found' });
    }
    res.json({ error: false, message: 'ok', user_id: result.rows[0].user_id });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: true, message: 'Email already exists' });
    }
    console.error('Error updating user:', e);
    res.status(500).json({ error: true, message: 'Error updating user' });
  }
});

// PUT toggle status
router.put('/users/:user_id/status', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: true, message: 'is_active must be a boolean' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1 WHERE user_id = $2 RETURNING user_id`,
      [is_active, user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'User not found' });
    }
    res.json({ error: false, message: 'ok', user_id: result.rows[0].user_id });
  } catch (e) {
    console.error('Error updating user status:', e);
    res.status(500).json({ error: true, message: 'Error updating user status' });
  }
});

// DELETE user
router.delete('/users/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE user_id = $1 RETURNING user_id`,
      [user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'User not found' });
    }
    res.json({ error: false, message: 'ok', user_id: result.rows[0].user_id });
  } catch (e) {
    console.error('Error deleting user:', e);
    res.status(500).json({ error: true, message: 'Error deleting user' });
  }
});

module.exports = router;