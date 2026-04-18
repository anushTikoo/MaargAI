import express from 'express';
import pool from '../db.js';
import { getRoutes } from '../services/routesService.js';

const router = express.Router();

// POST /api/trips/create-trip
router.post('/create-trip', async (req, res) => {
    try {
        const {
            fleet_manager_id,
            truck_id,
            source_lat,
            source_lng,
            dest_lat,
            dest_lng,
            deadline_timestamp // optional for MVP, maybe evaluated later
        } = req.body;

        // Task 2: Validate Input Data
        if (!fleet_manager_id || !truck_id) {
            return res.status(400).json({ error: "fleet_manager_id and truck_id are required." });
        }

        if (source_lat === undefined || source_lng === undefined || dest_lat === undefined || dest_lng === undefined) {
            return res.status(400).json({ error: "source_lat, source_lng, dest_lat, and dest_lng are required." });
        }

        const latLngs = [source_lat, source_lng, dest_lat, dest_lng];
        if (latLngs.some(val => typeof val !== 'number' || isNaN(val))) {
            return res.status(400).json({ error: "Coordinates must be valid numbers." });
        }

        if (source_lat < -90 || source_lat > 90 || dest_lat < -90 || dest_lat > 90) {
            return res.status(400).json({ error: "Latitudes must be between -90 and +90." });
        }
        if (source_lng < -180 || source_lng > 180 || dest_lng < -180 || dest_lng > 180) {
            return res.status(400).json({ error: "Longitudes must be between -180 and +180." });
        }

        // Task 3: Validate Ownership (Ensure truck exists & belongs to manager)
        const checkTruckQuery = `
            SELECT * FROM trucks 
            WHERE id = $1 AND fleet_manager_id = $2
        `;
        const truckCheck = await pool.query(checkTruckQuery, [truck_id, fleet_manager_id]);
        
        if (truckCheck.rowCount === 0) {
            return res.status(403).json({ error: "Truck does not exist or does not belong to the given fleet manager." });
        }

        // Task 4: Insert Trip (Initial State)
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const insertTripQuery = `
                INSERT INTO trips (
                    fleet_manager_id, truck_id, source_lat, source_lng, dest_lat, dest_lng, deadline_timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            const result = await client.query(insertTripQuery, [
                fleet_manager_id,
                truck_id,
                source_lat,
                source_lng,
                dest_lat,
                dest_lng,
                deadline_timestamp ? new Date(deadline_timestamp) : null
            ]);

            const trip = result.rows[0];
            const trip_id = trip.id;

            // Phase 3 & 4: Fetch and store routes
            let fetchedRoutes = [];
            try {
                fetchedRoutes = await getRoutes(source_lat, source_lng, dest_lat, dest_lng);
            } catch (routeErr) {
                console.error("Failed to fetch routes from Google API:", routeErr);
                throw new Error("Failed to calculate routes for this trip via Maps API.");
            }

            if (!fetchedRoutes || fetchedRoutes.length === 0) {
                throw new Error("No routes returned for this destination.");
            }

            // Task 9 & 10: Transform Routes and Insert into DB
            const routeMapping = {};
            
            // Route indices: 'A', 'B', 'C', ...
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            for (let i = 0; i < fetchedRoutes.length; i++) {
                const r = fetchedRoutes[i];
                const routeIndex = alphabet[i] || `R${i}`; // Fallback if somehow > 26 alternative routes

                const insertRouteQuery = `
                    INSERT INTO routes (
                        trip_id, route_index, polyline, distance_meters, duration_seconds, has_tolls
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id;
                `;

                const routeRes = await client.query(insertRouteQuery, [
                    trip_id,
                    routeIndex,
                    r.polyline,
                    r.distanceMeters,
                    r.durationSeconds,
                    r.hasTolls
                ]);

                // Store mapping: index -> route_id
                routeMapping[routeIndex] = routeRes.rows[0].id;
            }

            // Phase 5: Task 11 & 12 - Select Baseline Route & Update Trip
            // Google's best route is always the first one (index 'A')
            if (routeMapping['A'] && fetchedRoutes[0]) {
                const baselineRouteId = routeMapping['A'];
                const baselineDuration = fetchedRoutes[0].durationSeconds;
                const baselineDistance = fetchedRoutes[0].distanceMeters;

                const updateTripQuery = `
                    UPDATE trips
                    SET current_route_id = $1, baseline_eta_seconds = $2, baseline_distance_meters = $3
                    WHERE id = $4
                `;
                await client.query(updateTripQuery, [baselineRouteId, baselineDuration, baselineDistance, trip_id]);
                
                // Update in-memory reference to send accurately back in response
                trip.current_route_id = baselineRouteId;
                trip.baseline_eta_seconds = baselineDuration;
                trip.baseline_distance_meters = baselineDistance;
            }

            await client.query('COMMIT');

            return res.status(201).json({
                trip_id: trip_id,
                baseline_route: {
                    route_id: trip.current_route_id || null,
                    eta_seconds: trip.baseline_eta_seconds || null,
                    distance_meters: trip.baseline_distance_meters || null
                },
                total_routes: fetchedRoutes.length
            });

        } catch (txnError) {
            await client.query('ROLLBACK');
            console.error("Trip creation aborted/rolled back:", txnError);
            return res.status(500).json({ error: txnError.message || "Database transaction rolled back." });
        } finally {
            client.release();
        }



    } catch (e) {
        console.error("Error creating trip:", e);
        res.status(500).json({ error: "Internal server error." });
    }
});

export default router;
