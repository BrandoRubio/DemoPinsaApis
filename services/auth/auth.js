const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../../database/pool');

require('dotenv').config();

// ─── HELPERS ──────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    { user_id: user.user_id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { user_id: user.user_id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

function getExpiresAt(duration) {
  const units = { h: 3600, d: 86400 };
  const match = String(duration).match(/^(\d+)([hd])$/);
  if (!match) return new Date(Date.now() + 8 * 3600 * 1000);
  return new Date(Date.now() + parseInt(match[1]) * units[match[2]] * 1000);
}

// ─── LOGIN ────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: true, message: 'email and password are required' });
  }

  try {
    const userResult = await pool.query(
      `SELECT user_id, name, email, password, is_active, role, is_master FROM users WHERE email = $1`,
      [email]
    );
    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: true, message: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: true, message: 'Account is disabled' });
    }

    // Comparar contraseña — el frontend manda btoa(password) en base64
    // En DB se guarda también en base64: btoa(password) desde el frontend al crear usuario
    const validPassword = password === user.password;

    if (!validPassword) {
      return res.status(401).json({ error: true, message: 'Invalid credentials' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const expiresAt = getExpiresAt(process.env.JWT_EXPIRES_IN || '8h');

    // Guardar sesión en DB
    await pool.query(
      `INSERT INTO user_tokens (user_id, token, refresh_token, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.user_id,
        accessToken,
        refreshToken,
        expiresAt,
        req.ip || null,
        req.headers['user-agent'] || null
      ]
    );

    return res.json({
      error: false,
      message: 'ok',
      token: accessToken,
      refresh_token: refreshToken,
      data: [{
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,        // ← agregar esto
        is_master: user.is_master        // ← agregar esto
      }]
    });

  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: true, message: 'Internal server error' });
  }
});

// ─── REFRESH TOKEN ────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: true, message: 'refresh_token is required' });
  }

  try {
    // Verificar que el refresh token existe en DB y no está revocado
    const sessionResult = await pool.query(
      `SELECT ut.id, ut.user_id, u.name, u.email, u.is_active
       FROM user_tokens ut
       JOIN users u ON u.user_id = ut.user_id
       WHERE ut.refresh_token = $1 AND ut.is_revoked = FALSE`,
      [refresh_token]
    );

    if (sessionResult.rowCount === 0) {
      return res.status(401).json({ error: true, message: 'Invalid or revoked refresh token' });
    }

    const session = sessionResult.rows[0];

    if (!session.is_active) {
      return res.status(403).json({ error: true, message: 'Account is disabled' });
    }

    // Verificar firma del JWT
    jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);

    const newAccessToken = generateAccessToken(session);
    const newRefreshToken = generateRefreshToken(session);
    const expiresAt = getExpiresAt(process.env.JWT_EXPIRES_IN || '8h');

    // Revocar sesión anterior e insertar nueva (rotación)
    await pool.query(`UPDATE user_tokens SET is_revoked = TRUE WHERE id = $1`, [session.id]);
    await pool.query(
      `INSERT INTO user_tokens (user_id, token, refresh_token, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.user_id,
        newAccessToken,
        newRefreshToken,
        expiresAt,
        req.ip || null,
        req.headers['user-agent'] || null
      ]
    );

    return res.json({
      error: false,
      message: 'ok',
      token: newAccessToken,
      refresh_token: newRefreshToken
    });

  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: true, message: 'Invalid or expired refresh token' });
    }
    console.error('Refresh error:', e);
    return res.status(500).json({ error: true, message: 'Internal server error' });
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(400).json({ error: true, message: 'Token is required' });
  }

  try {
    await pool.query(
      `UPDATE user_tokens SET is_revoked = TRUE WHERE token = $1`,
      [token]
    );
    return res.json({ error: false, message: 'ok' });
  } catch (e) {
    console.error('Logout error:', e);
    return res.status(500).json({ error: true, message: 'Internal server error' });
  }
});

// ─── LOGOUT ALL SESSIONS ──────────────────────────────────────

router.post('/logout-all', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(400).json({ error: true, message: 'Token is required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    await pool.query(
      `UPDATE user_tokens SET is_revoked = TRUE WHERE user_id = $1`,
      [decoded.user_id]
    );
    return res.json({ error: false, message: 'ok' });
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: true, message: 'Invalid or expired token' });
    }
    console.error('Logout all error:', e);
    return res.status(500).json({ error: true, message: 'Internal server error' });
  }
});

module.exports = router;