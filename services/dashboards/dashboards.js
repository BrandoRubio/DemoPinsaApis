const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');
const checkPlantAccess = require('../../middleware/checkPlantAccess');

// GET dashboards (optionally filtered by plant_id)
router.get('/dashboards', authenticateToken, async (req, res) => {
  const { plant_id } = req.query;
  try {
    let query = `
      SELECT d.dashboard_id, d.plant_id, pl.name AS plant_name,
             d.name, d.description, d.index,
             d.created_at, d.updated_at
      FROM dashboards d
      JOIN plants pl ON pl.plant_id = d.plant_id
    `;
    const params = [];
    if (plant_id) {
      params.push(plant_id);
      query += ` WHERE d.plant_id = $${params.length}`;
    }
    query += ` ORDER BY d.index ASC, d.name ASC`;

    const result = await pool.query(query, params);
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching dashboards:', e);
    res.status(500).json({ error: true, message: 'Error fetching dashboards', data: [] });
  }
});
// GET /api/dashboards/:dashboard_id/widgets
router.get('/dashboards/:dashboard_id/widgets', authenticateToken, async (req, res) => {
  const { dashboard_id } = req.params;
  const user_id = req.user.user_id;

  try {
    // Obtener plant_id del dashboard
    const dashResult = await pool.query(
      `SELECT plant_id FROM dashboards WHERE dashboard_id = $1`,
      [dashboard_id]
    );

    if (dashResult.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Dashboard not found', data: [] });
    }

    const plant_id = dashResult.rows[0].plant_id;

    const hasAccess = await checkPlantAccess(user_id, plant_id);
    if (!hasAccess) {
      return res.status(403).json({ error: true, message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT
         d.dashboard_id, d.plant_id,
         pl.name          AS plant_name,
         pk.park_id,
         pk.name          AS park_name,
         d.name           AS dashboard_name,
         d.description    AS dashboard_description,
         d.index          AS dashboard_index,
         d.created_at     AS dashboard_created_at,
         d.updated_at     AS dashboard_updated_at,
         COALESCE(
           json_agg(
             jsonb_build_object(
               'widget_id',          w.widget_id,
               'dashboard_group_id', w.dashboard_group_id,
               'name',               w.name,
               'index',              w.index,
               'col_size',           w.col_size,
               'date_range',         w.date_range,
               'color',              w.color,
               'border_flag',        w.border_flag,
               'parameters',         w.parameters,
               'created_at',         w.created_at,
               'updated_at',         w.updated_at
             ) ORDER BY w.index ASC
           ) FILTER (WHERE w.widget_id IS NOT NULL),
           '[]'
         ) AS widgets
       FROM dashboards d
       JOIN plants  pl ON pl.plant_id = d.plant_id
       JOIN parks   pk ON pk.park_id  = pl.park_id
       LEFT JOIN widgets w ON w.dashboard_id = d.dashboard_id
       WHERE d.dashboard_id = $1
       GROUP BY d.dashboard_id, d.plant_id, pl.name,
                pk.park_id, pk.name, d.name, d.description,
                d.index, d.created_at, d.updated_at`,
      [dashboard_id]
    );

    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching dashboard widgets:', e);
    res.status(500).json({ error: true, message: 'Error fetching dashboard widgets', data: [] });
  }
});

router.get('/plant/:plant_id/dashboards', authenticateToken, async (req, res) => {
  const { plant_id } = req.params;
  const user_id = req.user.user_id;

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
         d.dashboard_id, d.name, d.description, d.index,
         d.created_at,   d.updated_at,
         COUNT(w.widget_id)::int AS widget_count
       FROM dashboards d
       LEFT JOIN widgets w ON w.dashboard_id = d.dashboard_id
       WHERE d.plant_id = $1
       GROUP BY d.dashboard_id, d.name, d.description, d.index,
                d.created_at, d.updated_at
       ORDER BY d.index ASC, d.name ASC`,
      [plant_id]
    );

    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching dashboards:', e);
    res.status(500).json({ error: true, message: 'Error fetching dashboards', data: [] });
  }
});
// Actualiza el tamaño (col_size) de un widget
router.put('/dashboards/size', authenticateToken, async (req, res) => {
  const { dashboard_id, colSize } = req.body;
  if (!dashboard_id || typeof colSize !== 'number') {
    return res.status(400).json({ error: true, message: 'dashboard_id and colSize are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const size = Math.min(Math.max(colSize, 1), 12);

    await client.query(
      `UPDATE widgets SET col_size = $1 WHERE widget_id = $2`,
      [size, dashboard_id]
    );

    await client.query('COMMIT');
    res.json({ error: false, message: 'ok' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error updating widget size:', e);
    res.status(500).json({ error: true, message: 'Error updating widget size' });
  } finally {
    client.release();
  }
});

// Actualiza las posiciones de múltiples widgets
router.put('/dashboards/order', authenticateToken, async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: true, message: 'items array is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await Promise.all(
      items.map(item =>
        client.query(
          `UPDATE widgets SET index = $1 WHERE widget_id = $2`,
          [item.index, item.dashboard_id]
        )
      )
    );

    await client.query('COMMIT');
    res.json({ error: false, message: 'ok' });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error updating widget order:', e);
    res.status(500).json({ error: true, message: 'Error updating widget order' });
  } finally {
    client.release();
  }
});

// Actualiza date_range de un widget
router.put('/dashboards/dateRange', authenticateToken, async (req, res) => {
  const { dashboard_id, dateRange } = req.body;

  if (!dashboard_id || !dateRange) {
    return res.status(400).json({ error: true, message: 'dashboard_id and dateRange are required' });
  }

  try {
    const result = await pool.query(
      `UPDATE widgets SET date_range = $1 WHERE widget_id = $2 RETURNING widget_id`,
      [dateRange, dashboard_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Widget not found' });
    }

    res.json({ error: false, message: 'ok', widget_id: result.rows[0].widget_id });
  } catch (e) {
    console.error('Error updating widget dateRange:', e);
    res.status(500).json({ error: true, message: 'Error updating widget dateRange' });
  }
});

// Actualiza múltiples widgets (color, border_flag, parameters)
router.put('/dashboards/multiple', authenticateToken, async (req, res) => {
  const { widgets } = req.body;
  const updated_by = req.user?.user_id || null;

  if (!Array.isArray(widgets) || widgets.length === 0) {
    return res.status(400).json({ error: true, message: 'widgets array is required' });
  }

  try {
    const updated = [];

    for (const widget of widgets) {
      const { dashboard_id, color, border_flag, parameters } = widget;

      const result = await pool.query(
        `UPDATE widgets
         SET color = $1, border_flag = $2, parameters = $3::jsonb, updated_by = $4
         WHERE widget_id = $5
         RETURNING widget_id`,
        [color, border_flag, parameters, updated_by, dashboard_id]
      );

      if (result.rowCount > 0) updated.push(result.rows[0]);
    }

    if (updated.length === 0) {
      return res.status(404).json({ error: true, message: 'No widgets found' });
    }

    res.json({ error: false, message: 'ok', total_updated: updated.length, data: updated });
  } catch (e) {
    console.error('Error updating multiple widgets:', e);
    res.status(500).json({ error: true, message: 'Error updating multiple widgets' });
  }
});

// Actualiza un widget por id
router.put('/dashboards/:id', authenticateToken, async (req, res) => {
  const widget_id = req.params.id;
  const { name, color, border_flag, parameters } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE widgets
       SET name = $1, color = $2, border_flag = $3, parameters = $4::jsonb, updated_by = $5
       WHERE widget_id = $6
       RETURNING widget_id`,
      [name, color, border_flag, parameters, updated_by, widget_id]
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

// GET single dashboard
router.get('/dashboards/:dashboard_id', authenticateToken, async (req, res) => {
  const { dashboard_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT d.dashboard_id, d.plant_id, pl.name AS plant_name,
              d.name, d.description, d.index,
              d.created_at, d.updated_at
       FROM dashboards d
       JOIN plants pl ON pl.plant_id = d.plant_id
       WHERE d.dashboard_id = $1`,
      [dashboard_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Dashboard not found', data: [] });
    }
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching dashboard:', e);
    res.status(500).json({ error: true, message: 'Error fetching dashboard', data: [] });
  }
});

// POST create dashboard
router.post('/dashboards', authenticateToken, async (req, res) => {
  const { plant_id, name, description, index } = req.body;
  const created_by = req.user?.user_id || null;

  if (!plant_id || !name) {
    return res.status(400).json({ error: true, message: 'plant_id and name are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO dashboards (plant_id, name, description, index, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING dashboard_id`,
      [plant_id, name, description, index, created_by]
    );
    res.status(201).json({ error: false, message: 'ok', dashboard_id: result.rows[0].dashboard_id });
  } catch (e) {
    console.error('Error creating dashboard:', e);
    res.status(500).json({ error: true, message: 'Error creating dashboard' });
  }
});

// PUT update dashboard
router.put('/dashboards/:dashboard_id', authenticateToken, async (req, res) => {
  const { dashboard_id } = req.params;
  const { plant_id, name, description, index } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE dashboards
       SET plant_id = $1, name = $2, description = $3, index = $4, updated_by = $5
       WHERE dashboard_id = $6
       RETURNING dashboard_id`,
      [plant_id, name, description, index, updated_by, dashboard_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Dashboard not found' });
    }
    res.json({ error: false, message: 'ok', dashboard_id: result.rows[0].dashboard_id });
  } catch (e) {
    console.error('Error updating dashboard:', e);
    res.status(500).json({ error: true, message: 'Error updating dashboard' });
  }
});

// DELETE dashboard
router.delete('/dashboards/:dashboard_id', authenticateToken, async (req, res) => {
  const { dashboard_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM dashboards WHERE dashboard_id = $1 RETURNING dashboard_id`,
      [dashboard_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Dashboard not found' });
    }
    res.json({ error: false, message: 'ok', dashboard_id: result.rows[0].dashboard_id });
  } catch (e) {
    console.error('Error deleting dashboard:', e);
    res.status(500).json({ error: true, message: 'Error deleting dashboard' });
  }
});

module.exports = router;