
const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/authenticateToken');
const pool = require('../../database/pool');
const checkPlantAccess = require('../../middleware/checkPlantAccess');

// ─── HELPERS ──────────────────────────────────────────────────

async function getCallerRole(user_id) {
    const res = await pool.query(
        `SELECT role, is_master FROM users WHERE user_id = $1`,
        [user_id]
    );
    return res.rows[0] || { role: 'viewer', is_master: false };
}

// =============================================================
// GET
// =============================================================

// GET usuarios master — solo is_master = true
router.get('/users-master', authenticateToken, async (req, res) => {
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Access denied' });
    }

    try {
        const result = await pool.query(
            `SELECT user_id, name, email, role, is_master, is_active, created_at
       FROM users
       WHERE is_master = TRUE
       ORDER BY name ASC`
        );
        res.json({ error: false, message: 'ok', data: result.rows });
    } catch (e) {
        console.error('Error fetching master users:', e);
        res.status(500).json({ error: true, message: 'Error fetching master users', data: [] });
    }
});
// GET buscar usuarios por nombre o email
router.get('/users', authenticateToken, async (req, res) => {
    const { search } = req.query;
    try {
        const term = `%${search || ''}%`;
        const result = await pool.query(
            `SELECT user_id, name, email, role, is_active
       FROM users
       WHERE (name ILIKE $1 OR email ILIKE $1)
         AND is_active = TRUE
       ORDER BY name ASC
       LIMIT 20`,
            [term]
        );
        res.json({ error: false, message: 'ok', data: result.rows });
    } catch (e) {
        console.error('Error searching users:', e);
        res.status(500).json({ error: true, message: 'Error searching users', data: [] });
    }
});
// GET usuarios de un parque — excluye master, solo los asignados al parque
// sin aparecer en ninguna planta de ese parque
router.get('/parks/:park_id/users', authenticateToken, async (req, res) => {
    const { park_id } = req.params;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        const access = await pool.query(
            `SELECT 1 FROM park_access WHERE park_id = $1 AND user_id = $2`,
            [park_id, req.user.user_id]
        );
        if (access.rowCount === 0) {
            return res.status(403).json({ error: true, message: 'Access denied to this park' });
        }
    }

    try {
        const result = await pool.query(
            `SELECT
         u.user_id, u.name, u.email, u.role, u.is_active,
         pa.role      AS park_role,
         pa.granted_at
       FROM park_access pa
       JOIN users u ON u.user_id = pa.user_id
       WHERE pa.park_id = $1
         AND u.is_master = FALSE
         AND u.user_id NOT IN (
           SELECT pla.user_id
           FROM plant_access pla
           JOIN plants pl ON pl.plant_id = pla.plant_id
           WHERE pl.park_id = $1
         )
       ORDER BY u.name ASC`,
            [park_id]
        );
        res.json({ error: false, message: 'ok', data: result.rows });
    } catch (e) {
        console.error('Error fetching park users:', e);
        res.status(500).json({ error: true, message: 'Error fetching park users', data: [] });
    }
});
// GET usuarios de una planta — excluye master y usuarios de parque
router.get('/plants/:plant_id/users', authenticateToken, async (req, res) => {
    const { plant_id } = req.params;
    const user_id = req.user.user_id;

    try {
        const hasAccess = await checkPlantAccess(user_id, plant_id);
        if (!hasAccess) {
            return res.status(403).json({ error: true, message: 'Access denied to this plant' });
        }

        const result = await pool.query(
            `SELECT
         u.user_id, u.name, u.email, u.role, u.is_active,
         pla.role      AS plant_role,
         pla.granted_at
       FROM plant_access pla
       JOIN users u ON u.user_id = pla.user_id
       WHERE pla.plant_id = $1
         AND u.is_master = FALSE
         AND u.user_id NOT IN (
           SELECT pa.user_id FROM park_access pa
           JOIN plants pl ON pl.park_id = pa.park_id
           WHERE pl.plant_id = $1
         )
       ORDER BY u.name ASC`,
            [plant_id]
        );

        res.json({ error: false, message: 'ok', data: result.rows });
    } catch (e) {
        console.error('Error fetching plant users:', e);
        res.status(500).json({ error: true, message: 'Error fetching plant users', data: [] });
    }
});
// DELETE revocar acceso a planta
router.delete('/plants/:plant_id/users/:user_id', authenticateToken, async (req, res) => {
    const { plant_id, user_id } = req.params;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master && caller.role === 'viewer') {
        return res.status(403).json({ error: true, message: 'Access denied' });
    }

    try {
        await pool.query(
            `DELETE FROM plant_access WHERE plant_id = $1 AND user_id = $2`,
            [plant_id, user_id]
        );
        res.json({ error: false, message: 'ok' });
    } catch (e) {
        console.error('Error revoking plant access:', e);
        res.status(500).json({ error: true, message: 'Error revoking plant access' });
    }
});
// =============================================================
// POST
// =============================================================

// POST crear usuario master — solo superadmin/master puede
router.post('/users/master', authenticateToken, async (req, res) => {
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master || caller.role !== 'superadmin') {
        return res.status(403).json({ error: true, message: 'Only superadmin can create master users' });
    }

    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: true, message: 'name, email and password are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO users (name, email, password, role, is_master, is_active)
       VALUES ($1, $2, $3, $4, TRUE, TRUE)
       RETURNING user_id`,
            [name, email, password, role || 'admin']
        );
        await client.query('COMMIT');
        res.status(201).json({ error: false, message: 'ok', user_id: result.rows[0].user_id });
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505') {
            return res.status(409).json({ error: true, message: 'Email already exists' });
        }
        console.error('Error creating master user:', e);
        res.status(500).json({ error: true, message: 'Error creating master user' });
    } finally {
        client.release();
    }
});

// POST asignar usuario a parque — solo master/superadmin puede
router.post('/parks/:park_id/users', authenticateToken, async (req, res) => {
    const { park_id } = req.params;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Only master users can assign park access' });
    }

    const { user_id, role } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: true, message: 'user_id is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Upsert — si ya existe actualiza el rol
        const result = await client.query(
            `INSERT INTO park_access (park_id, user_id, role, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (park_id, user_id) DO UPDATE SET role = $3
       RETURNING access_id`,
            [park_id, user_id, role || 'viewer', req.user.user_id]
        );

        await client.query('COMMIT');
        res.status(201).json({ error: false, message: 'ok', access_id: result.rows[0].access_id });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error assigning park access:', e);
        res.status(500).json({ error: true, message: 'Error assigning park access' });
    } finally {
        client.release();
    }
});

// POST asignar usuario a planta — master o admin puede
router.post('/plants/:plant_id/users', authenticateToken, async (req, res) => {
    const { plant_id } = req.params;
    const caller = await getCallerRole(req.user.user_id);

    // Admin solo puede asignar en plantas a las que él tiene acceso
    if (!caller.is_master) {
        if (caller.role === 'viewer') {
            return res.status(403).json({ error: true, message: 'Viewers cannot assign plant access' });
        }
        const access = await pool.query(
            `SELECT 1 FROM plant_access WHERE plant_id = $1 AND user_id = $2`,
            [plant_id, req.user.user_id]
        );
        if (access.rowCount === 0) {
            return res.status(403).json({ error: true, message: 'Access denied to this plant' });
        }
    }

    const { user_id, role } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: true, message: 'user_id is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `INSERT INTO plant_access (plant_id, user_id, role, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (plant_id, user_id) DO UPDATE SET role = $3
       RETURNING access_id`,
            [plant_id, user_id, role || 'viewer', req.user.user_id]
        );

        await client.query('COMMIT');
        res.status(201).json({ error: false, message: 'ok', access_id: result.rows[0].access_id });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error assigning plant access:', e);
        res.status(500).json({ error: true, message: 'Error assigning plant access' });
    } finally {
        client.release();
    }
});
// PUT actualizar rol de usuario en parque
router.put('/parks/:park_id/users/:user_id', authenticateToken, async (req, res) => {
    const { park_id, user_id } = req.params;
    const { role } = req.body;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Only master users can edit park access' });
    }

    try {
        const result = await pool.query(
            `UPDATE park_access SET role = $1 WHERE park_id = $2 AND user_id = $3
       RETURNING access_id`,
            [role, park_id, user_id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: true, message: 'Access not found' });
        }
        res.json({ error: false, message: 'ok' });
    } catch (e) {
        console.error('Error updating park access:', e);
        res.status(500).json({ error: true, message: 'Error updating park access' });
    }
});

// DELETE revocar acceso a parque
router.delete('/parks/:park_id/users/:user_id', authenticateToken, async (req, res) => {
    const { park_id, user_id } = req.params;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Only master users can revoke park access' });
    }

    try {
        await pool.query(
            `DELETE FROM park_access WHERE park_id = $1 AND user_id = $2`,
            [park_id, user_id]
        );
        res.json({ error: false, message: 'ok' });
    } catch (e) {
        console.error('Error revoking park access:', e);
        res.status(500).json({ error: true, message: 'Error revoking park access' });
    }
});

// PUT editar usuario master — solo nombre y rol
router.put('/users/:user_id', authenticateToken, async (req, res) => {
    const { user_id } = req.params;
    const { name, role } = req.body;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Access denied' });
    }

    // No puede editarse a sí mismo el rol
    if (parseInt(user_id) === req.user.user_id && role !== caller.role) {
        return res.status(400).json({ error: true, message: 'Cannot change your own role' });
    }

    try {
        const result = await pool.query(
            `UPDATE users SET name = $1, role = $2 WHERE user_id = $3 AND is_master = TRUE
       RETURNING user_id`,
            [name, role, user_id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: true, message: 'Master user not found' });
        }
        res.json({ error: false, message: 'ok', user_id: result.rows[0].user_id });
    } catch (e) {
        console.error('Error updating master user:', e);
        res.status(500).json({ error: true, message: 'Error updating master user' });
    }
});

// PUT toggle status
router.put('/users/:user_id/status', authenticateToken, async (req, res) => {
    const { user_id } = req.params;
    const { is_active } = req.body;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Access denied' });
    }

    if (parseInt(user_id) === req.user.user_id) {
        return res.status(400).json({ error: true, message: 'Cannot change your own status' });
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

// DELETE eliminar usuario
router.delete('/users/:user_id', authenticateToken, async (req, res) => {
    const { user_id } = req.params;
    const caller = await getCallerRole(req.user.user_id);

    if (!caller.is_master) {
        return res.status(403).json({ error: true, message: 'Access denied' });
    }

    if (parseInt(user_id) === req.user.user_id) {
        return res.status(400).json({ error: true, message: 'Cannot delete yourself' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM park_access  WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM plant_access WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM user_tokens  WHERE user_id = $1`, [user_id]);
        await client.query(`DELETE FROM users        WHERE user_id = $1`, [user_id]);
        await client.query('COMMIT');
        res.json({ error: false, message: 'ok' });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error deleting user:', e);
        res.status(500).json({ error: true, message: 'Error deleting user' });
    } finally {
        client.release();
    }
});
module.exports = router;