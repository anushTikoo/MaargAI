import express from 'express';
import pool from '../db.js';
import { getRoutes } from '../services/routesService.js';

const router = express.Router();

// GET /api/trips?fleet_manager_id=123
router.get('/', async (req, res) => {
    try {
        const { fleet_manager_id } = req.query;

        if (!fleet_manager_id) {
            return res.status(400).json({ error: 'fleet_manager_id is required.' });
        }

        const parsedFleetManagerId = Number(fleet_manager_id);

        if (!Number.isInteger(parsedFleetManagerId) || parsedFleetManagerId <= 0) {
            return res.status(400).json({ error: 'fleet_manager_id must be a positive integer.' });
        }

        const tripsQuery = `
            SELECT
                t.*,
                tr.truck_number,
                tr.truck_type,
                r.route_index AS current_route_index,
                r.distance_meters AS current_route_distance_meters,
                r.duration_seconds AS current_route_duration_seconds,
                r.has_tolls AS current_route_has_tolls
            FROM trips t
            JOIN trucks tr ON tr.id = t.truck_id
            LEFT JOIN routes r ON r.id = t.current_route_id
            WHERE t.fleet_manager_id = $1
            ORDER BY t.created_at DESC
        `;

        const result = await pool.query(tripsQuery, [parsedFleetManagerId]);

        return res.status(200).json({
            trips: result.rows,
        });
    } catch (error) {
        console.error('Error fetching trips:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/trips/:trip_id/routes?fleet_manager_id=123
router.get('/:trip_id/routes', async (req, res) => {
    try {
        const { trip_id } = req.params;
        const { fleet_manager_id } = req.query;

        const parsedTripId = Number(trip_id);
        const parsedFleetManagerId = Number(fleet_manager_id);

        if (!Number.isInteger(parsedTripId) || parsedTripId <= 0) {
            return res.status(400).json({ error: 'trip_id must be a positive integer.' });
        }

        if (!Number.isInteger(parsedFleetManagerId) || parsedFleetManagerId <= 0) {
            return res.status(400).json({ error: 'fleet_manager_id must be a positive integer.' });
        }

        const tripOwnership = await pool.query(
            'SELECT id FROM trips WHERE id = $1 AND fleet_manager_id = $2',
            [parsedTripId, parsedFleetManagerId]
        );

        if (tripOwnership.rowCount === 0) {
            return res.status(404).json({ error: 'Trip not found for this fleet manager.' });
        }

        const routesResult = await pool.query(
            `SELECT id, trip_id, route_index, polyline, distance_meters, duration_seconds, has_tolls, created_at
             FROM routes
             WHERE trip_id = $1
             ORDER BY route_index ASC`,
            [parsedTripId]
        );

        return res.status(200).json({
            trip_id: parsedTripId,
            routes: routesResult.rows,
        });
    } catch (error) {
        console.error('Error fetching routes for trip:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// DELETE /api/trips/:trip_id?fleet_manager_id=123
router.delete('/:trip_id', async (req, res) => {
    try {
        const { trip_id } = req.params;
        const { fleet_manager_id } = req.query;

        const parsedTripId = Number(trip_id);
        const parsedFleetManagerId = Number(fleet_manager_id);

        if (!Number.isInteger(parsedTripId) || parsedTripId <= 0) {
            return res.status(400).json({ error: 'trip_id must be a positive integer.' });
        }

        if (!Number.isInteger(parsedFleetManagerId) || parsedFleetManagerId <= 0) {
            return res.status(400).json({ error: 'fleet_manager_id must be a positive integer.' });
        }

        const deleteResult = await pool.query(
            'DELETE FROM trips WHERE id = $1 AND fleet_manager_id = $2 RETURNING id',
            [parsedTripId, parsedFleetManagerId]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ error: 'Trip not found for this fleet manager.' });
        }

        return res.status(200).json({
            message: 'Trip deleted successfully.',
            deletedId: deleteResult.rows[0].id,
        });
    } catch (error) {
        console.error('Error deleting trip:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /api/trips/create-trip
router.post('/create-trip', async (req, res) => {
    try {
        const {
            fleet_manager_id,
            truck_id,
            source,
            destination,
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

        if (typeof source !== 'string' || !source.trim() || typeof destination !== 'string' || !destination.trim()) {
            return res.status(400).json({ error: 'source and destination are required as non-empty text.' });
        }

        const normalizedSource = source.trim();
        const normalizedDestination = destination.trim();

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
                    fleet_manager_id, truck_id, source, destination, source_lat, source_lng, dest_lat, dest_lng, deadline_timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `;
            const result = await client.query(insertTripQuery, [
                fleet_manager_id,
                truck_id,
                normalizedSource,
                normalizedDestination,
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

                if (routeErr?.statusCode) {
                    throw routeErr;
                }

                const wrappedRouteError = new Error(routeErr?.message || 'Failed to calculate routes for this trip via Maps API.');
                wrappedRouteError.statusCode = 502;
                throw wrappedRouteError;
            }

            if (!fetchedRoutes || fetchedRoutes.length === 0) {
                const noRoutesError = new Error('No routes returned for this destination.');
                noRoutesError.statusCode = 422;
                throw noRoutesError;
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

            const statusCode =
                Number.isInteger(txnError?.statusCode) && txnError.statusCode >= 400 && txnError.statusCode < 600
                    ? txnError.statusCode
                    : 500;

            return res.status(statusCode).json({ error: txnError.message || 'Database transaction rolled back.' });
        } finally {
            client.release();
        }



    } catch (e) {
        console.error("Error creating trip:", e);
        res.status(500).json({ error: "Internal server error." });
    }
});

export default router;
