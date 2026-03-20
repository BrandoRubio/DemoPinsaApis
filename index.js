require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// ─── CORS ──────────────────────────────────────────────────────
app.use(cors({
    origin: ['http://localhost:8100', 'http://localhost:8101', 'https://finsa-x1vt.onrender.com'],
    credentials: true
}));

// ─── BODY PARSER ───────────────────────────────────────────────
app.use(express.json());

// ─── RUTAS ─────────────────────────────────────────────────────

// Auth
app.use('/api', require('./services/auth/auth'));

// Usuarios y sesiones
app.use('/api', require('./services/users/users'));
app.use('/api', require('./services/users/users_access'));

// Geografía
app.use('/api', require('./services/parks/parks'));
app.use('/api', require('./services/plants/plants'));

// Dashboards
app.use('/api', require('./services/dashboards/dashboards'));
app.use('/api', require('./services/dashboards/widgets'));

// Summary
app.use('/api', require('./services/summary/summary'));

// IoT
app.use('/api', require('./services/devices/devices'));
app.use('/api', require('./services/sensors/sensors'));
app.use('/api', require('./services/sensors/sensor_data'));

// Eventos
app.use('/api', require('./services/events/events'));

// ─── HEALTH CHECK ──────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'IoT API', timestamp: new Date() });
});

// ─── 404 ───────────────────────────────────────────────────────
/*app.use((req, res) => {
    res.status(404).json({ errorsExistFlag: true, message: 'Ruta no encontrada' });
});*/

// ─── ERROR HANDLER GLOBAL ──────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({ errorsExistFlag: true, message: 'Error interno del servidor' });
});

// ─── SERVIDOR ──────────────────────────────────────────────────
const { initWebSocket } = require('./services/websocket/websocket');

const server = app.listen(port, () => {
    console.log(`Servidor corriendo en puerto ${port}`);
});

initWebSocket(server);