const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET /api/plant/:plant_id/summary
router.get('/plant/:plant_id/summary', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  const user_id      = req.user.user_id;

  try {
    const caller = await pool.query(
      `SELECT role, is_master FROM users WHERE user_id = $1`,
      [user_id]
    );
    const { is_master } = caller.rows[0];

    // Verificar acceso según nivel
    if (!is_master) {
      const access = await pool.query(
        `SELECT 1 FROM plant_access
         WHERE plant_id = $1 AND user_id = $2

         UNION

         SELECT 1 FROM park_access pa
         JOIN plants pl ON pl.park_id = pa.park_id
         WHERE pl.plant_id = $1 AND pa.user_id = $2`,
        [plant_id, user_id]
      );

      if (access.rowCount === 0) {
        return res.status(403).json({ error: true, message: 'Access denied to this plant' });
      }
    }

    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)
          FROM devices
          WHERE plant_id = $1 AND is_active = TRUE)                     AS devices,

         (SELECT COUNT(*)
          FROM dashboards
          WHERE plant_id = $1)                                           AS dashboards,

         (SELECT COUNT(*)
          FROM sensors s
          JOIN devices d ON d.device_id = s.device_id
          WHERE d.plant_id = $1 AND s.is_active = TRUE)                 AS sensors,

         (SELECT COUNT(*)
          FROM plant_access pla
          JOIN users u ON u.user_id = pla.user_id
          WHERE pla.plant_id = $1
            AND u.is_master = FALSE
            AND u.user_id NOT IN (
              SELECT pa.user_id FROM park_access pa
              JOIN plants pl ON pl.park_id = pa.park_id
              WHERE pl.plant_id = $1
            ))                                                           AS users,

         (SELECT COUNT(*)
          FROM events e
          JOIN sensors s ON s.sensor_id = e.sensor_id
          JOIN devices d ON d.device_id = s.device_id
          WHERE d.plant_id = $1 AND e.is_active = TRUE)                 AS events`,
      [plant_id]
    );

    const counts = result.rows[0];

    res.json({
      error:   false,
      message: 'ok',
      data: [{
        plant_id:   parseInt(plant_id),
        devices:    parseInt(counts.devices),
        dashboards: parseInt(counts.dashboards),
        sensors:    parseInt(counts.sensors),
        users:      parseInt(counts.users),
        events:     parseInt(counts.events)
      }]
    });

  } catch (e) {
    console.error('Error fetching summary:', e);
    res.status(500).json({ error: true, message: 'Error fetching summary', data: [] });
  }
});

module.exports = router;