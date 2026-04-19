
import pool from '../db.js';

async function checkTripsAndRoutes() {
    try {
        const trips = await pool.query('SELECT id, source_lat, source_lng, dest_lat, dest_lng, current_route_id, baseline_eta_seconds FROM trips ORDER BY id DESC LIMIT 5');
        console.log('Recent Trips:', JSON.stringify(trips.rows, null, 2));

        const routes = await pool.query('SELECT count(*) FROM routes');
        console.log('Total Routes in DB:', routes.rows[0].count);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit();
    }
}

checkTripsAndRoutes();
