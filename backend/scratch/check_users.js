
import pool from '../db.js';

async function checkUsers() {
    try {
        const res = await pool.query('SELECT id, email FROM users ORDER BY id');
        console.log('Users in DB:', JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error('Error checking users:', e);
    } finally {
        process.exit();
    }
}

checkUsers();
