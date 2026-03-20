const pool = require('../database/pool');

async function checkPlantAccess(user_id, plant_id) {
    const caller = await pool.query(
        `SELECT role, is_master FROM users WHERE user_id = $1`,
        [user_id]
    );
    const { is_master } = caller.rows[0];

    if (is_master) return true;

    const access = await pool.query(
        `SELECT 1 FROM plant_access
     WHERE plant_id = $1 AND user_id = $2
     UNION
     SELECT 1 FROM park_access pa
     JOIN plants pl ON pl.park_id = pa.park_id
     WHERE pl.plant_id = $1 AND pa.user_id = $2`,
        [plant_id, user_id]
    );

    return access.rowCount > 0;
}

module.exports = checkPlantAccess;