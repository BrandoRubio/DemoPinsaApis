const jwt = require('jsonwebtoken');
const pool = require('../database/pool');
require('dotenv').config();

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: true, message: 'Access token required' });
  }

  try {
    // 1. Verificar firma JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 2. Verificar que la sesión existe en DB y no está revocada
    const sessionResult = await pool.query(
      `SELECT ut.id, ut.expires_at, ut.is_revoked, u.is_active
       FROM user_tokens ut
       JOIN users u ON u.user_id = ut.user_id
       WHERE ut.token = $1`,
      [token]
    );

    if (sessionResult.rowCount === 0) {
      return res.status(401).json({ error: true, message: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    if (session.is_revoked) {
      return res.status(401).json({ error: true, message: 'Session has been revoked' });
    }

    if (new Date() > new Date(session.expires_at)) {
      return res.status(401).json({ error: true, message: 'Session expired' });
    }

    if (!session.is_active) {
      return res.status(403).json({ error: true, message: 'Account is disabled' });
    }

    req.user = decoded;
    next();

  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: true, message: 'Token expired' });
    }
    if (e.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: true, message: 'Invalid token' });
    }
    console.error('Auth middleware error:', e);
    return res.status(500).json({ error: true, message: 'Internal server error' });
  }
}

module.exports = authenticateToken;