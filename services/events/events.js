const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET events (optionally filtered by sensor_id)
router.get('/events', authenticateToken, async (req, res) => {
  const { sensor_id } = req.query;
  try {
    let query = `
      SELECT e.event_id, e.sensor_id, s.title AS sensor_title,
             e.name, e.description, e.conditions, e.actions,
             e.is_active, e.created_at, e.updated_at
      FROM events e
      JOIN sensors s ON s.sensor_id = e.sensor_id
    `;
    const params = [];
    if (sensor_id) {
      params.push(sensor_id);
      query += ` WHERE e.sensor_id = $${params.length}`;
    }
    query += ` ORDER BY e.name ASC`;

    const result = await pool.query(query, params);
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching events:', e);
    res.status(500).json({ error: true, message: 'Error fetching events', data: [] });
  }
});

// GET single event
router.get('/events/:event_id', authenticateToken, async (req, res) => {
  const { event_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT e.event_id, e.sensor_id, s.title AS sensor_title,
              e.name, e.description, e.conditions, e.actions,
              e.is_active, e.created_at, e.updated_at
       FROM events e
       JOIN sensors s ON s.sensor_id = e.sensor_id
       WHERE e.event_id = $1`,
      [event_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Event not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching event:', e);
    res.status(500).json({ error: true, message: 'Error fetching event', data: [] });
  }
});

// POST create event
router.post('/events', authenticateToken, async (req, res) => {
  const { sensor_id, name, description, conditions, actions } = req.body;
  const created_by = req.user?.user_id || null;

  if (!sensor_id || !name) {
    return res.status(400).json({ error: true, message: 'sensor_id and name are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO events (sensor_id, name, description, conditions, actions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING event_id`,
      [sensor_id, name, description, conditions, actions, created_by]
    );
    res.status(201).json({ error: false, message: 'ok', event_id: result.rows[0].event_id });
  } catch (e) {
    console.error('Error creating event:', e);
    res.status(500).json({ error: true, message: 'Error creating event' });
  }
});

// PUT update event
router.put('/events/:event_id', authenticateToken, async (req, res) => {
  const { event_id } = req.params;
  const { sensor_id, name, description, conditions, actions, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE events
       SET sensor_id = $1, name = $2, description = $3,
           conditions = $4, actions = $5, is_active = $6
       WHERE event_id = $7
       RETURNING event_id`,
      [sensor_id, name, description, conditions, actions, is_active, event_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Event not found' });
    }
    res.json({ error: false, message: 'ok', event_id: result.rows[0].event_id });
  } catch (e) {
    console.error('Error updating event:', e);
    res.status(500).json({ error: true, message: 'Error updating event' });
  }
});

// DELETE event
router.delete('/events/:event_id', authenticateToken, async (req, res) => {
  const { event_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM events WHERE event_id = $1 RETURNING event_id`,
      [event_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Event not found' });
    }
    res.json({ error: false, message: 'ok', event_id: result.rows[0].event_id });
  } catch (e) {
    console.error('Error deleting event:', e);
    res.status(500).json({ error: true, message: 'Error deleting event' });
  }
});

module.exports = router;