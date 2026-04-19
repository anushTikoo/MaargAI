
import pool from '../db.js';

async function checkTrucks() {
    try {
        const res = await pool.query('SELECT fleet_manager_id, truck_number FROM trucks ORDER BY fleet_manager_id, truck_number');
        console.log('Trucks in DB:', JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error('Error checking trucks:', e);
    } finally {
        process.exit();
    }
}

checkTrucks();
