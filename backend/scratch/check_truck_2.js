
import pool from '../db.js';

async function checkTruck2() {
    try {
        const res = await pool.query('SELECT * FROM trucks WHERE id = 2');
        console.log('Truck 2 info:', JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error('Error checking truck 2:', e);
    } finally {
        process.exit();
    }
}

checkTruck2();
