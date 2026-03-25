const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');
const checkPlantAccess = require('../../middleware/checkPlantAccess');

// GET devices (optionally filtered by plant_id)
router.get('/devices', authenticateToken, async (req, res) => {
  const { plant_id } = req.query;
  try {
    let query = `
      SELECT d.device_id, d.plant_id, pl.name AS plant_name,
             d.name, d.token, d.type, d.description, d.is_active,
             d.created_at, d.updated_at
      FROM devices d
      JOIN plants pl ON pl.plant_id = d.plant_id
      WHERE d.is_active = TRUE
    `;
    const params = [];
    if (plant_id) {
      params.push(plant_id);
      query += ` AND d.plant_id = $${params.length}`;
    }
    query += ` ORDER BY d.name ASC`;

    const result = await pool.query(query, params);
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching devices:', e);
    res.status(500).json({ error: true, message: 'Error fetching devices', data: [] });
  }
});
// GET devices y sensores por usuario
router.get('/machinesAndSensors/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         d.device_id        AS machine_id,
         d.name             AS machine_name,
         d.token            AS token,
         d.type             AS machine_code,
         d.plant_id         AS organization_id,
         COALESCE(
           json_agg(
             json_build_object(
               'sensor_id',       s.sensor_id,
               'sensor_name',     s.title,
               'sensor_icon',     s.icon,
               'sensor_var',      s.var,
               'last_value',      sd.value,
               'last_date_time',  sd.recorded_at
             )
           ) FILTER (WHERE s.sensor_id IS NOT NULL),
           '[]'::json
         ) AS sensors
       FROM plant_access pa
       JOIN plants  pl ON pl.plant_id  = pa.plant_id
       JOIN devices d  ON d.plant_id   = pl.plant_id
       LEFT JOIN sensors s ON s.device_id = d.device_id AND s.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT sd.value, sd.recorded_at
         FROM sensor_data sd
         WHERE sd.sensor_id = s.sensor_id
         ORDER BY sd.recorded_at DESC
         LIMIT 1
       ) sd ON TRUE
       WHERE pa.user_id = $1
         AND d.is_active = TRUE
       GROUP BY d.device_id, d.name, d.token, d.type, d.plant_id
       ORDER BY d.name ASC`,
      [userId]
    );

    res.json({
      error: false,
      message: 'ok',
      total_results: result.rows.length,
      data: result.rows
    });
  } catch (e) {
    console.error('Error fetching machines and sensors:', e);
    res.status(500).json({ error: true, message: 'Error fetching machines and sensors' });
  }
});

// GET devices y sensores por planta (equivalente a byCompany)
router.get('/machinesAndSensorsByCompany/:companyId', authenticateToken, async (req, res) => {
  const { companyId } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         d.device_id        AS machine_id,
         d.name             AS machine_name,
         d.token            AS token,
         d.type             AS machine_code,
         d.plant_id         AS organization_id,
         COALESCE(
           json_agg(
             json_build_object(
               'sensor_id',       s.sensor_id,
               'sensor_name',     s.title,
               'sensor_icon',     s.icon,
               'sensor_var',      s.var,
               'last_value',      sd.value,
               'last_date_time',  sd.recorded_at
             )
           ) FILTER (WHERE s.sensor_id IS NOT NULL),
           '[]'::json
         ) AS sensors
       FROM devices d
       JOIN plants  pl ON pl.plant_id = d.plant_id
       JOIN parks   pk ON pk.park_id  = pl.park_id
       LEFT JOIN sensors s ON s.device_id = d.device_id AND s.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT sd.value, sd.recorded_at
         FROM sensor_data sd
         WHERE sd.sensor_id = s.sensor_id
         ORDER BY sd.recorded_at DESC
         LIMIT 1
       ) sd ON TRUE
       WHERE pk.park_id = $1
         AND d.token IS NOT NULL
         AND d.token <> ''
         AND d.is_active = TRUE
       GROUP BY d.device_id, d.name, d.token, d.type, d.plant_id
       ORDER BY d.device_id ASC`,
      [companyId]
    );

    res.json({
      error: false,
      message: 'ok',
      total_results: result.rows.length,
      data: result.rows
    });
  } catch (e) {
    console.error('Error fetching machines and sensors by company:', e);
    res.status(500).json({ error: true, message: 'Error fetching machines and sensors by company' });
  }
});

router.get('/machinesAndSensorsByOrganizations', authenticateToken, async (req, res) => {
  const { organizations } = req.query;
  const user_id = req.user.user_id;

  if (!organizations) {
    return res.status(400).json({ error: true, message: 'organizations param is required' });
  }

  const requestedIds = String(organizations)
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id));

  if (requestedIds.length === 0) {
    return res.status(400).json({ error: true, message: 'No valid plant IDs provided' });
  }

  try {
    const caller = await pool.query(
      `SELECT role, is_master FROM users WHERE user_id = $1`,
      [user_id]
    );
    const { is_master } = caller.rows[0];

    let plantIds = requestedIds;

    if (!is_master) {
      // Filtrar solo plantas a las que el usuario tiene acceso
      const accessResult = await pool.query(
        `SELECT DISTINCT pl.plant_id
         FROM plants pl
         WHERE pl.plant_id = ANY($1::int[])
           AND (
             EXISTS (
               SELECT 1 FROM plant_access pla
               WHERE pla.plant_id = pl.plant_id AND pla.user_id = $2
             )
             OR EXISTS (
               SELECT 1 FROM park_access pa
               WHERE pa.park_id = pl.park_id AND pa.user_id = $2
             )
           )`,
        [requestedIds, user_id]
      );

      plantIds = accessResult.rows.map(r => r.plant_id);

      if (plantIds.length === 0) {
        return res.status(403).json({ error: true, message: 'Access denied to requested plants' });
      }
    }

    const result = await pool.query(
      `SELECT
         d.device_id        AS machine_id,
         d.name             AS machine_name,
         d.token            AS token,
         d.type             AS machine_code,
         d.plant_id         AS organization_id,
         pl.name            AS organization_name,
         COALESCE(
           json_agg(
             json_build_object(
               'sensor_id',      s.sensor_id,
               'sensor_name',    s.title,
               'sensor_icon',    s.icon,
               'sensor_var',     s.var,
               'last_value',     sd.value,
               'last_date_time', sd.recorded_at
             )
           ) FILTER (WHERE s.sensor_id IS NOT NULL),
           '[]'::json
         ) AS sensors
       FROM devices d
       JOIN plants pl ON pl.plant_id = d.plant_id
       LEFT JOIN sensors s ON s.device_id = d.device_id AND s.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT sd.value, sd.recorded_at
         FROM sensor_data sd
         WHERE sd.sensor_id = s.sensor_id
         ORDER BY sd.recorded_at DESC
         LIMIT 1
       ) sd ON TRUE
       WHERE pl.plant_id = ANY($1::int[])
         AND d.token IS NOT NULL
         AND d.token <> ''
         AND d.is_active = TRUE
       GROUP BY d.device_id, d.name, d.token, d.type, d.plant_id, pl.name
       ORDER BY pl.name ASC, d.name ASC`,
      [plantIds]
    );
    res.json({
      error: false,
      message: 'ok',
      total_results: result.rows.length,
      data: result.rows
    });

  } catch (e) {
    console.error('Error fetching machines and sensors by organizations:', e);
    res.status(500).json({ error: true, message: 'Error fetching machines and sensors by organizations' });
  }
});
// GET single device
router.get('/devices/:device_id', authenticateToken, async (req, res) => {
  const { device_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT d.device_id, d.plant_id, pl.name AS plant_name,
              d.name, d.token, d.type, d.description, d.is_active,
              d.created_at, d.updated_at
       FROM devices d
       JOIN plants pl ON pl.plant_id = d.plant_id
       WHERE d.device_id = $1`,
      [device_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Device not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching device:', e);
    res.status(500).json({ error: true, message: 'Error fetching device', data: [] });
  }
});
// GET /api/plant/:plant_id/devices-sensors
router.get('/plant/:plant_id/devices-sensors', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  const user_id = req.user.user_id;

  try {
    const hasAccess = await checkPlantAccess(user_id, plant_id);
    if (!hasAccess) {
      return res.status(403).json({ error: true, message: 'Access denied to this plant' });
    }

    const result = await pool.query(
      `SELECT
         d.device_id, d.name, d.token, d.type, d.description, d.is_active,
         COALESCE(
           json_agg(
             jsonb_build_object(
               'sensor_id',        s.sensor_id,
               'var',              s.var,
               'title',            s.title,
               'icon',             s.icon,
               'unit',             s.unit,
               'is_active',        s.is_active,
               'last_value',       sd.value,
               'last_recorded_at', sd.recorded_at
             )
           ) FILTER (WHERE s.sensor_id IS NOT NULL),
           '[]'
         ) AS sensors
       FROM devices d
       LEFT JOIN sensors s ON s.device_id = d.device_id
       LEFT JOIN LATERAL (
         SELECT value, recorded_at FROM sensor_data
         WHERE sensor_id = s.sensor_id
         ORDER BY recorded_at DESC LIMIT 1
       ) sd ON TRUE
       WHERE d.plant_id = $1
       GROUP BY d.device_id, d.name, d.token, d.type, d.description, d.is_active
       ORDER BY d.name ASC`,
      [plant_id]
    );

    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching devices with sensors:', e);
    res.status(500).json({ error: true, message: 'Error fetching devices with sensors', data: [] });
  }
});
// POST create device
router.post('/devices', authenticateToken, async (req, res) => {
  const { plant_id, name, token, type, description } = req.body;
  const created_by = req.user?.user_id || null;

  if (!plant_id || !name) {
    return res.status(400).json({ error: true, message: 'plant_id and name are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO devices (plant_id, name, token, type, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING device_id`,
      [plant_id, name, token, type, description, created_by]
    );
    res.status(201).json({ error: false, message: 'ok', device_id: result.rows[0].device_id });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: true, message: 'Device token already exists' });
    }
    console.error('Error creating device:', e);
    res.status(500).json({ error: true, message: 'Error creating device' });
  }
});

// PUT update device
router.put('/devices/:device_id', authenticateToken, async (req, res) => {
  const { device_id } = req.params;
  const { plant_id, name, token, type, description, is_active } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE devices
       SET plant_id = $1, name = $2, token = $3, type = $4,
           description = $5, is_active = $6, updated_by = $7
       WHERE device_id = $8
       RETURNING device_id`,
      [plant_id, name, token, type, description, is_active, updated_by, device_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Device not found' });
    }
    res.json({ error: false, message: 'ok', device_id: result.rows[0].device_id });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: true, message: 'Device token already exists' });
    }
    console.error('Error updating device:', e);
    res.status(500).json({ error: true, message: 'Error updating device' });
  }
});

// DELETE device
router.delete('/devices/:device_id', authenticateToken, async (req, res) => {
  const { device_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM devices WHERE device_id = $1 RETURNING device_id`,
      [device_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Device not found' });
    }
    res.json({ error: false, message: 'ok', device_id: result.rows[0].device_id });
  } catch (e) {
    console.error('Error deleting device:', e);
    res.status(500).json({ error: true, message: 'Error deleting device' });
  }
});

module.exports = router;