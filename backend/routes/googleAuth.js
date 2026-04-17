import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import pool from '../db.js';

const router = express.Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Scopes we request from Google
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

// GET /api/auth/google
// Redirects the user to Google's OAuth consent screen
router.get('/', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

// GET /api/auth/google/call  ack
// Google redirects here after user grants/denies permission
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  const BASE_URL = process.env.CLIENT_URL;

  if (error) return res.redirect(`${BASE_URL}/signup?error=access_denied`);
  if (!code) return res.redirect(`${BASE_URL}/signup?error=missing_code`);

  try {
    // Exchange the authorization code for tokens
    const { tokens } = await oAuth2Client.getToken(code);

    // Verify and decode the ID token to get user info
    const ticket = await oAuth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email } = payload;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email]
    );

    let user;
    let isNewUser = false;

    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];

      // Link Google account if they registered via email/password first
      if (!user.google_id) {
        await pool.query(
          'UPDATE users SET google_id = $1 WHERE id = $2',
          [googleId, user.id]
        );
        user.google_id = googleId;
      }
    } else {
      // New user — insert without role
      const result = await pool.query(
        `INSERT INTO users (email, google_id)
         VALUES ($1, $2)
         RETURNING id, email, google_id`,
        [email, googleId]
      );
      user = result.rows[0];
      isNewUser = true;
    }

    res.redirect(`${BASE_URL}/fleet-info`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`${BASE_URL}/signup?error=server_error`);
  }
});

export default router;
