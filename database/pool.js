const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    /*ssl: {
        rejectUnauthorized: false, // Evitar bloqueos en de conexión
    },*/
});

module.exports = pool;