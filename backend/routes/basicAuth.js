import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../db.js';
import {
  createAuthToken,
  serializeAuthCookie,
  serializeClearAuthCookie,
} from '../utils/authSession.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  let { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  email = email.toLowerCase();

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists.' });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert the new user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [email, hashedPassword]
    );

    const newUser = result.rows[0];
    const authToken = createAuthToken(newUser);

    res.setHeader('Set-Cookie', serializeAuthCookie(authToken));

    res.status(201).json({
      message: 'User registered successfully.',
      user: {
        id: newUser.id,
        email: newUser.email,
      },
      token: authToken,
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  let { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  email = email.toLowerCase();

  try {
    // Look up user by email
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // If account was created via Google OAuth, it won't have a password
    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account uses Google Sign-In. Please login with Google.',
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const authToken = createAuthToken({ id: user.id, email: user.email });

    res.setHeader('Set-Cookie', serializeAuthCookie(authToken));

    res.status(200).json({
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
      },
      token: authToken,
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {

  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [req.auth.sub]
    );

    if (result.rows.length === 0) {
      res.setHeader('Set-Cookie', serializeClearAuthCookie());
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    return res.status(200).json({
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', serializeClearAuthCookie());
  return res.status(200).json({ message: 'Logged out successfully.' });
});

export default router;
