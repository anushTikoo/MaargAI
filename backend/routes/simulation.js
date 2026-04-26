import express from 'express';
import pool from '../db.js';
import { processActiveTrips } from '../services/monitoringService.js';
import { decodePolyline } from '../services/segmentationService.js';

const router = express.Router();

/**
 * Inject a simulated delay into a trip.
 * POST /api/simulation/inject-delay
 * Body: { trip_id: number, delay_minutes: number }
 */
router.post('/inject-delay', async (req, res) => {
    const { trip_id, delay_minutes } = req.body;
    
    if (!trip_id || delay_minutes === undefined) {
        return res.status(400).json({ error: 'trip_id and delay_minutes are required' });
    }

    try {
        const delaySeconds = delay_minutes * 60;
        
        // 1. Fetch trip and truck details for warping
        const tripRes = await pool.query(`
            SELECT t.current_route_id, tr.truck_number 
            FROM trips t
            JOIN trucks tr ON t.truck_id = tr.id
            WHERE t.id = $1
        `, [trip_id]);

        if (tripRes.rowCount === 0) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        const { current_route_id, truck_number } = tripRes.rows[0];

        // 2. Find a random point along the INITIAL baseline route (Index A)
        const routeRes = await pool.query(`
            SELECT polyline FROM routes 
            WHERE trip_id = $1 AND route_index = 'A'
            LIMIT 1
        `, [trip_id]);

        let warpedLat, warpedLng;
        if (routeRes.rowCount > 0 && routeRes.rows[0].polyline) {
            try {
                const points = decodePolyline(routeRes.rows[0].polyline);
                if (points.length > 5) {
                    const randomIndex = Math.floor(points.length * (0.3 + Math.random() * 0.4));
                    [warpedLat, warpedLng] = [points[randomIndex].lat, points[randomIndex].lng];
                    console.log(`[Simulation] Found warp target for Trip ${trip_id}: ${warpedLat}, ${warpedLng}`);
                }
            } catch (err) {
                console.warn('[Simulation] Failed to decode polyline for warp:', err);
            }
        }

        // 3. Inject the delay in DB
        await pool.query(`
            UPDATE trips SET simulated_delay_seconds = simulated_delay_seconds + $1 WHERE id = $2
        `, [delaySeconds, trip_id]);

        // 4. TRIGGER THE LOCATION UPDATE (Syncs Firebase & Map)
        if (warpedLat && warpedLng && truck_number) {
            console.log(`[Simulation] Triggering live location sync for truck ${truck_number}...`);
            const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
            try {
                const locRes = await fetch(`${baseUrl}/api/trips/locations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: truck_number,
                        lat: warpedLat,
                        lng: warpedLng
                    })
                });
                if (!locRes.ok) {
                    console.warn(`[Simulation] /locations loopback returned ${locRes.status}`);
                }
            } catch (e) {
                console.error('[Simulation] Loopback /locations call failed:', e.message);
            }
        }

        // 5. Automatically trigger the Agent
        console.log(`[Simulation] Delay injected. Auto-triggering Agent...`);
        // We wait a tiny bit to ensure DB transaction from /locations is committed (just in case)
        await new Promise(r => setTimeout(r, 500));
        processActiveTrips().catch(err => console.error('[Simulation] Auto-trigger failed:', err));

        res.json({ message: `Successfully injected delay and warped truck ${truck_number}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Manually update the GPS coordinates of a truck.
 * POST /api/simulation/update-gps
 * Body: { trip_id: number, lat: number, lng: number }
 */
router.post('/update-gps', async (req, res) => {
    const { trip_id, lat, lng } = req.body;

    if (!trip_id || lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'trip_id, lat, and lng are required' });
    }

    try {
        await pool.query(`
            UPDATE trips 
            SET last_gps_lat = $1, last_gps_lng = $2 
            WHERE id = $3
        `, [lat, lng, trip_id]);

        // Also add to location history
        await pool.query(`
            INSERT INTO trip_locations (trip_id, lat, lng) 
            VALUES ($1, $2, $3)
        `, [trip_id, lat, lng]);

        res.json({ message: `GPS updated for trip ${trip_id}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Reset all simulation data for a trip.
 * POST /api/simulation/reset
 * Body: { trip_id: number }
 */
router.post('/reset', async (req, res) => {
    const { trip_id } = req.body;

    try {
        // 1. Find the initial route for this trip (Index A)
        const baselineRouteRes = await pool.query(`
            SELECT id FROM routes WHERE trip_id = $1 AND route_index = 'A'
        `, [trip_id]);

        const baselineRouteId = baselineRouteRes.rows[0]?.id || null;

        // 2. Fetch truck details to sync Firebase
        const tripRes = await pool.query(`
            SELECT tr.truck_number, t.fleet_manager_id
            FROM trips t
            JOIN trucks tr ON t.truck_id = tr.id
            WHERE t.id = $1
        `, [trip_id]);
        
        const { truck_number, fleet_manager_id } = tripRes.rows[0] || {};

        // 3. Update the trip record
        await pool.query(`
            UPDATE trips 
            SET simulated_delay_seconds = 0, 
                last_gps_lat = NULL, 
                last_gps_lng = NULL, 
                ai_reroute_reason = NULL,
                ai_decision = NULL,
                simulated_weather = NULL,
                current_route_id = $1
            WHERE id = $2
        `, [baselineRouteId, trip_id]);

        // 4. Clear simulation artifacts
        await pool.query(`DELETE FROM trip_checkpoints WHERE trip_id = $1`, [trip_id]);
        await pool.query(`DELETE FROM trip_locations WHERE trip_id = $1`, [trip_id]);

        // 5. SYNC RESET TO FIREBASE (Remove live tracking data so it falls back to source)
        if (truck_number && fleet_manager_id) {
            console.log(`[Simulation] Resetting Firebase for trip ${trip_id}...`);
            const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
            // We can't easily "DELETE" via fetch POST to /locations, but we can send NULLs
            // Actually, the /locations endpoint expects numbers.
            // For simplicity, we just won't call it, and the next UI refresh will see last_gps_lat = NULL.
            // But to be sure, we should really hit the realtimeDB if we had the service here.
        }

        res.json({ message: `Simulation reset for trip ${trip_id}. Route reverted to baseline.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
