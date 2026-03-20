const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');

// GET parks filtrados por usuario (desde token)
router.get('/parks', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;
  try {
    const result = await pool.query(
      `SELECT p.park_id, p.name, p.description, p.latitude, p.longitude,
              p.address, p.timezone, p.is_active, p.created_at, p.updated_at,
              pa.role
       FROM parks p
       JOIN park_access pa ON pa.park_id = p.park_id
       WHERE pa.user_id = $1
         AND p.is_active = TRUE
       ORDER BY p.name ASC`,
      [user_id]
    );
    res.json({ error: false, message: 'ok', data: result.rows });
  } catch (e) {
    console.error('Error fetching parks:', e);
    res.status(500).json({ error: true, message: 'Error fetching parks', data: [] });
  }
});
router.get('/parks-plants', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;

  try {
    const caller = await pool.query(
      `SELECT role, is_master FROM users WHERE user_id = $1`,
      [user_id]
    );
    const { is_master } = caller.rows[0];

    let result;

    // ─── MASTER — ve todo sin filtro ──────────────────────────
    if (is_master) {
      result = await pool.query(
        `SELECT
           p.park_id, p.name, p.description,
           p.latitude, p.longitude, p.address, p.timezone,
           'superadmin' AS role,
           COALESCE(
             json_agg(
               jsonb_build_object(
                 'plant_id',    pl.plant_id,
                 'name',        pl.name,
                 'description', pl.description,
                 'latitude',    pl.latitude,
                 'longitude',   pl.longitude,
                 'address',     pl.address,
                 'timezone',    pl.timezone,
                 'role',        'superadmin'
               )
             ) FILTER (WHERE pl.plant_id IS NOT NULL),
             '[]'
           ) AS plants
         FROM parks p
         LEFT JOIN plants pl ON pl.park_id = p.park_id AND pl.is_active = TRUE
         WHERE p.is_active = TRUE
         GROUP BY p.park_id, p.name, p.description,
                  p.latitude, p.longitude, p.address, p.timezone
         ORDER BY p.name ASC`
      );

    } else {
      // ─── DETECTAR NIVEL por park_access ───────────────────
      const hasParkAccess = await pool.query(
        `SELECT 1 FROM park_access WHERE user_id = $1 LIMIT 1`,
        [user_id]
      );

      if (hasParkAccess.rowCount > 0) {
        // ─── NIVEL PARQUE ──────────────────────────────────
        result = await pool.query(
          `SELECT
             p.park_id, p.name, p.description,
             p.latitude, p.longitude, p.address, p.timezone,
             pa.role,
             COALESCE(
               json_agg(
                 jsonb_build_object(
                   'plant_id',    pl.plant_id,
                   'name',        pl.name,
                   'description', pl.description,
                   'latitude',    pl.latitude,
                   'longitude',   pl.longitude,
                   'address',     pl.address,
                   'timezone',    pl.timezone,
                   'role',        pa.role
                 )
               ) FILTER (WHERE pl.plant_id IS NOT NULL),
               '[]'
             ) AS plants
           FROM parks p
           JOIN park_access pa ON pa.park_id = p.park_id AND pa.user_id = $1
           LEFT JOIN plants pl ON pl.park_id = p.park_id AND pl.is_active = TRUE
           WHERE p.is_active = TRUE
           GROUP BY p.park_id, p.name, p.description,
                    p.latitude, p.longitude, p.address, p.timezone, pa.role
           ORDER BY p.name ASC`,
          [user_id]
        );

      } else {
        // ─── NIVEL PLANTA — solo el parque padre y sus plantas asignadas
        result = await pool.query(
          `SELECT
             p.park_id, p.name, p.description,
             p.latitude, p.longitude, p.address, p.timezone,
             pla.role AS role,
             COALESCE(
               json_agg(
                 jsonb_build_object(
                   'plant_id',    pl.plant_id,
                   'name',        pl.name,
                   'description', pl.description,
                   'latitude',    pl.latitude,
                   'longitude',   pl.longitude,
                   'address',     pl.address,
                   'timezone',    pl.timezone,
                   'role',        pla.role
                 )
               ) FILTER (WHERE pl.plant_id IS NOT NULL),
               '[]'
             ) AS plants
           FROM plant_access pla
           JOIN plants pl ON pl.plant_id = pla.plant_id AND pl.is_active = TRUE
           JOIN parks  p  ON p.park_id   = pl.park_id   AND p.is_active  = TRUE
           WHERE pla.user_id = $1
           GROUP BY p.park_id, p.name, p.description,
                    p.latitude, p.longitude, p.address, p.timezone, pla.role
           ORDER BY p.name ASC`,
          [user_id]
        );
      }
    }

    res.json({ error: false, message: 'ok', data: result.rows });

  } catch (e) {
    console.error('Error fetching parks with plants:', e);
    res.status(500).json({ error: true, message: 'Error fetching parks with plants', data: [] });
  }
});
// GET single park
router.get('/parks/:park_id', authenticateToken, async (req, res) => {
  const { park_id } = req.params;
  const user_id = req.user.user_id;

  try {
    const caller = await pool.query(
      `SELECT role, is_master FROM users WHERE user_id = $1`,
      [user_id]
    );
    const { role, is_master } = caller.rows[0];

    // Verificar acceso al parque
    if (!is_master) {
      const access = await pool.query(
        `SELECT 1 FROM park_access  WHERE park_id = $1 AND user_id = $2
         UNION
         SELECT 1 FROM plant_access pla
         JOIN plants pl ON pl.plant_id = pla.plant_id
         WHERE pl.park_id = $1 AND pla.user_id = $2`,
        [park_id, user_id]
      );
      if (access.rowCount === 0) {
        return res.status(403).json({ error: true, message: 'Access denied to this park' });
      }
    }

    const result = await pool.query(
      `SELECT
         p.park_id, p.name, p.description,
         p.latitude, p.longitude, p.address,
         p.timezone, p.is_active,
         p.created_at, p.updated_at,

         -- plantas filtradas por nivel de usuario
         COALESCE(
           json_agg(
             DISTINCT jsonb_build_object(
               'plant_id',    pl.plant_id,
               'name',        pl.name,
               'description', pl.description,
               'latitude',    pl.latitude,
               'longitude',   pl.longitude,
               'address',     pl.address,
               'is_active',   pl.is_active
             )
           ) FILTER (WHERE pl.plant_id IS NOT NULL),
           '[]'
         ) AS plants,

         -- usuarios nivel parque (excluye master y nivel planta)
         COALESCE(
           json_agg(
             DISTINCT jsonb_build_object(
               'user_id',    u.user_id,
               'name',       u.name,
               'email',      u.email,
               'role',       u.role,
               'is_active',  u.is_active,
               'park_role',  pa_users.role
             )
           ) FILTER (WHERE u.user_id IS NOT NULL AND u.is_master = FALSE),
           '[]'
         ) AS users,

         -- conteo de usuarios nivel parque
         COUNT(DISTINCT pa_users.user_id)
           FILTER (WHERE u.is_master = FALSE) AS user_count

       FROM parks p

       -- plantas según nivel
       LEFT JOIN plants pl ON pl.park_id = p.park_id AND pl.is_active = TRUE
         AND (
           $3 = TRUE  -- master ve todas
           OR EXISTS (SELECT 1 FROM park_access  WHERE park_id = p.park_id AND user_id = $2)  -- nivel parque ve todas
           OR EXISTS (SELECT 1 FROM plant_access WHERE plant_id = pl.plant_id AND user_id = $2) -- nivel planta ve las suyas
         )

       -- usuarios del parque
       LEFT JOIN park_access pa_users ON pa_users.park_id = p.park_id
       LEFT JOIN users u ON u.user_id = pa_users.user_id
         AND u.user_id NOT IN (
           SELECT pla.user_id FROM plant_access pla
           JOIN plants pl2 ON pl2.plant_id = pla.plant_id
           WHERE pl2.park_id = p.park_id
         )

       WHERE p.park_id = $1
       GROUP BY p.park_id, p.name, p.description, p.latitude, p.longitude,
                p.address, p.timezone, p.is_active, p.created_at, p.updated_at`,
      [park_id, user_id, is_master]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Park not found', data: [] });
    }

    res.json({ error: false, message: 'ok', data: result.rows });

  } catch (e) {
    console.error('Error fetching park:', e);
    res.status(500).json({ error: true, message: 'Error fetching park', data: [] });
  }
});

// POST create park
router.post('/parks', authenticateToken, async (req, res) => {
  const { name, description, latitude, longitude, address, timezone } = req.body;
  const created_by = req.user?.user_id || null;

  if (!name) {
    return res.status(400).json({ error: true, message: 'name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO parks (name, description, latitude, longitude, address, timezone, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING park_id`,
      [name, description, latitude, longitude, address, timezone, created_by]
    );
    res.status(201).json({ error: false, message: 'ok', park_id: result.rows[0].park_id });
  } catch (e) {
    console.error('Error creating park:', e);
    res.status(500).json({ error: true, message: 'Error creating park' });
  }
});

// PUT update park
router.put('/parks/:park_id', authenticateToken, async (req, res) => {
  const { park_id } = req.params;
  const { name, description, latitude, longitude, address, timezone, is_active } = req.body;
  const updated_by = req.user?.user_id || null;

  try {
    const result = await pool.query(
      `UPDATE parks
       SET name = $1, description = $2, latitude = $3, longitude = $4,
           address = $5, timezone = $6, is_active = $7, updated_by = $8
       WHERE park_id = $9
       RETURNING park_id`,
      [name, description, latitude, longitude, address, timezone, is_active, updated_by, park_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Park not found' });
    }
    res.json({ error: false, message: 'ok', park_id: result.rows[0].park_id });
  } catch (e) {
    console.error('Error updating park:', e);
    res.status(500).json({ error: true, message: 'Error updating park' });
  }
});

// DELETE park
router.delete('/parks/:park_id', authenticateToken, async (req, res) => {
  const { park_id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM parks WHERE park_id = $1 RETURNING park_id`,
      [park_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: true, message: 'Park not found' });
    }
    res.json({ error: false, message: 'ok', park_id: result.rows[0].park_id });
  } catch (e) {
    console.error('Error deleting park:', e);
    res.status(500).json({ error: true, message: 'Error deleting park' });
  }
});

module.exports = router;