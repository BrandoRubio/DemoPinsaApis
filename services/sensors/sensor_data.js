const express = require('express');
const router = express.Router();
const pool = require('../../database/pool');
const { notifySensorData } = require('../websocket/websocket');

router.get('/sensorsData', async (req, res) => {
  const { sensors, from, to, limit } = req.query;

  if (!sensors) {
    return res.status(400).json({ error: true, message: 'sensors param is required', data: [] });
  }

  const sensorIDs = sensors.split(',').map(id => id.trim()).filter(id => id !== '');

  if (sensorIDs.length === 0) {
    return res.status(400).json({ error: true, message: 'At least one valid sensor_id is required', data: [] });
  }

  try {
    const sensorsData = [];

    for (const sensorId of sensorIDs) {
      const params = [sensorId];
      let whereClause = 'WHERE sd.sensor_id = $1';
      let paramIndex = 2;

      if (from) {
        params.push(from);
        whereClause += ` AND sd.recorded_at >= $${paramIndex++}`;
      }
      if (to) {
        params.push(to);
        whereClause += ` AND sd.recorded_at <= $${paramIndex++}`;
      }

      let limitClause = '';
      if (limit) {
        params.push(parseInt(limit));
        limitClause = `LIMIT $${paramIndex++}`;
      }

      const result = await pool.query(
        `SELECT s.title AS sensor_name, s.var, s.unit, sd.value, sd.recorded_at
         FROM sensor_data sd
         JOIN sensors s ON s.sensor_id = sd.sensor_id
         ${whereClause}
         ORDER BY sd.recorded_at DESC ${limitClause}`,
        params
      );

      sensorsData.push({
        sensor_id: parseInt(sensorId),
        sensor_name: result.rows[0]?.sensor_name || null,
        var: result.rows[0]?.var || null,
        unit: result.rows[0]?.unit || null,
        data: result.rows.map(row => ({
          value: row.value,
          time: row.recorded_at
        }))
      });
    }

    res.json({
      error: false,
      message: 'ok',
      total_sensors: sensorsData.length,
      data: sensorsData
    });

  } catch (e) {
    console.error('Error fetching sensor data:', e);
    res.status(500).json({ error: true, message: 'Error fetching sensor data', data: [] });
  }
});
router.get('/sensorData/:sensor_id', async (req, res) => {
  const { sensor_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT s.title AS sensor_name, s.var, s.unit, sd.value, sd.recorded_at
       FROM sensor_data sd
       JOIN sensors s ON s.sensor_id = sd.sensor_id
       WHERE sd.sensor_id = $1
         AND sd.recorded_at IS NOT NULL
       ORDER BY sd.recorded_at DESC
       LIMIT 1`,
      [sensor_id]
    );

    const row = result.rows[0];

    res.json({
      error:       false,
      message:     'ok',
      data: [{
        sensor_id:   parseInt(sensor_id),
        sensor_name: row?.sensor_name || null,
        var:         row?.var         || null,
        unit:        row?.unit        || null,
        value:       row?.value       || null,
        time:        row?.recorded_at || null
      }]
    });

  } catch (e) {
    console.error('Error fetching sensor data:', e);
    res.status(500).json({ error: true, message: 'Error fetching sensor data', data: [] });
  }
});

router.get('/sensorsLatest', async (req, res) => {
  const { sensors } = req.query;

  if (!sensors) {
    return res.status(400).json({ error: true, message: 'sensors param is required', data: [] });
  }

  const sensorIDs = sensors.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));

  if (sensorIDs.length === 0) {
    return res.status(400).json({ error: true, message: 'At least one valid sensor_id is required', data: [] });
  }

  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (sd.sensor_id)
         sd.sensor_id,
         s.title AS sensor_name,
         s.var,
         s.unit,
         sd.value,
         sd.recorded_at
       FROM sensor_data sd
       JOIN sensors s ON s.sensor_id = sd.sensor_id
       WHERE sd.sensor_id = ANY($1::int[])
         AND sd.recorded_at IS NOT NULL
       ORDER BY sd.sensor_id, sd.recorded_at DESC`,
      [sensorIDs]
    );

    res.json({
      error:         false,
      message:       'ok',
      total_sensors: result.rows.length,
      data:          result.rows.map(row => ({
        sensor_id:   row.sensor_id,
        sensor_name: row.sensor_name,
        var:         row.var,
        unit:        row.unit,
        value:       row.value,
        time:        row.recorded_at
      }))
    });

  } catch (e) {
    console.error('Error fetching latest sensor data:', e);
    res.status(500).json({ error: true, message: 'Error fetching latest sensor data', data: [] });
  }
});

router.get('/sensorsDataHM', async (req, res) => {
  const { sensors, from, to, limit } = req.query;

  if (!sensors) {
    return res.status(400).json({ error: true, message: 'sensors param is required', data: [] });
  }

  const sensorIDs = sensors.split(',').map(id => id.trim()).filter(id => id !== '');

  if (sensorIDs.length === 0) {
    return res.status(400).json({ error: true, message: 'At least one valid sensor_id is required', data: [] });
  }

  if (!from || !to) {
    return res.status(400).json({ error: true, message: 'from and to params are required', data: [] });
  }

  try {
    const sensorsData = [];

    for (const sensorId of sensorIDs) {
      const params = [sensorId, from, to];

      let limitClause = '';
      if (limit) {
        params.push(parseInt(limit));
        limitClause = `LIMIT $${params.length}`;
      }

      const result = await pool.query(
        `SELECT
           (sd.recorded_at AT TIME ZONE 'UTC')::date          AS day,
           s.sensor_id,
           s.title                                             AS sensor_name,
           s.var,
           s.unit,
           EXTRACT(HOUR FROM sd.recorded_at AT TIME ZONE 'UTC') AS hour,
           AVG(sd.value)                                       AS avg_value
         FROM sensors s
         INNER JOIN sensor_data sd ON sd.sensor_id = s.sensor_id
         WHERE s.sensor_id = $1
           AND sd.recorded_at >= $2::timestamptz
           AND sd.recorded_at <  $3::timestamptz
         GROUP BY
           (sd.recorded_at AT TIME ZONE 'UTC')::date,
           s.sensor_id,
           s.title,
           s.var,
           s.unit,
           EXTRACT(HOUR FROM sd.recorded_at AT TIME ZONE 'UTC')
         ORDER BY day DESC, hour ASC
         ${limitClause}`,
        params
      );

      const data = result.rows.map(row => {
        const dayStr = new Date(row.day).toISOString().split('T')[0];
        const hour = row.hour !== null ? row.hour : 0;
        return {
          value: row.avg_value !== null ? parseFloat(parseFloat(row.avg_value).toFixed(2)) : 0,
          time: `${dayStr}T${String(hour).padStart(2, '0')}:00:00Z`
        };
      });

      sensorsData.push({
        sensor_id: parseInt(sensorId),
        sensor_name: result.rows[0]?.sensor_name || null,
        var: result.rows[0]?.var || null,
        unit: result.rows[0]?.unit || null,
        data
      });
    }

    res.json({
      error: false,
      message: 'ok',
      total_sensors: sensorsData.length,
      data: sensorsData
    });

  } catch (e) {
    console.error('Error fetching heatmap sensor data:', e);
    res.status(500).json({ error: true, message: 'Error fetching heatmap sensor data', data: [] });
  }
});
// POST ingest sensor data — no authenticateToken, uses device token
// Body: { token: 'device_token', var: 'temp', value: 23.5 }
// or bulk: { token: 'device_token', readings: [{ var: 'temp', value: 23.5 }, ...] }
router.post('/sensorData', async (req, res) => {
  const { token, items } = req.body;

  if (!token || !items || !Array.isArray(items)) {
    return res.status(400).json({ error: true, message: 'token and items array are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolver device por token
    const deviceResult = await client.query(
      `SELECT d.device_id, d.plant_id FROM devices d
       WHERE d.token = $1 AND d.is_active = TRUE LIMIT 1`,
      [token]
    );

    if (deviceResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: true, message: 'Device not found or inactive' });
    }

    const { device_id, plant_id } = deviceResult.rows[0];
    const results = [];

    for (const { sensor_var, value } of items) {
      if (!sensor_var || value === undefined) continue;

      let sensor_id;

      // Buscar sensor por var y device_id
      const sensorQuery = await client.query(
        `SELECT sensor_id FROM sensors
         WHERE device_id = $1 AND var = $2 LIMIT 1`,
        [device_id, sensor_var]
      );

      if (sensorQuery.rowCount === 0) {
        // Auto-crear sensor si no existe
        const newSensor = await client.query(
          `INSERT INTO sensors (device_id, var, title, icon, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING sensor_id`,
          [device_id, sensor_var, sensor_var.toUpperCase(), 'help-circle-outline']
        );
        sensor_id = newSensor.rows[0].sensor_id;
        results.push({ sensor_var, status: 'sensor auto-created' });
      } else {
        sensor_id = sensorQuery.rows[0].sensor_id;
      }

      // Insertar dato
      const insertResult = await client.query(
        `INSERT INTO sensor_data (sensor_id, value, recorded_at)
         VALUES ($1, $2, NOW())
         RETURNING data_id, value, recorded_at`,
        [sensor_id, value]
      );

      const row     = insertResult.rows[0];
      const payload = {
        sensor_id,
        sensor_var,
        device_id,
        plant_id,
        value:       row.value,
        time: row.recorded_at
      };

      // Notificar suscriptores
      notifySensorData(sensor_id, { data: payload });
      /*notifyDeviceData(device_id,  { data: payload });
      notifyPlantData(plant_id,    { data: payload });*/

      results.push({ sensor_var, status: 'ok' });
    }

    await client.query('COMMIT');

    res.json({
      error:   false,
      message: 'ok',
      data:    results
    });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error inserting sensor data bulk:', e);
    res.status(500).json({ error: true, message: 'Error inserting sensor data' });
  } finally {
    client.release();
  }
});
module.exports = router;