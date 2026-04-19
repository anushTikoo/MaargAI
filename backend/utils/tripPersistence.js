import { getRoutes } from '../services/routesService.js';

function createTripError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function toNullableString(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    return text || null;
}

function toFiniteNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    const parsed = Number.parseFloat(String(value).trim().replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function toIntegerOrNull(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const n = Number.parseInt(String(value).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDeadline(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    const d = new Date(String(value).trim());
    if (Number.isNaN(d.getTime())) {
        throw createTripError('deadline_timestamp is not a valid date.');
    }
    return d;
}

function assertCoordinateBounds(source_lat, source_lng, dest_lat, dest_lng) {
    if (source_lat < -90 || source_lat > 90 || dest_lat < -90 || dest_lat > 90) {
        throw createTripError('Latitudes must be between -90 and +90.');
    }
    if (source_lng < -180 || source_lng > 180 || dest_lng < -180 || dest_lng > 180) {
        throw createTripError('Longitudes must be between -180 and +180.');
    }
}

async function resolveTruckIdForFleet(client, fleetManagerId, truckIdInput, truckNumberInput) {
    const truckId = toIntegerOrNull(truckIdInput);
    const truckNumber = toNullableString(truckNumberInput);

    if (truckId !== null) {
        const res = await client.query(
            'SELECT id FROM trucks WHERE id = $1 AND fleet_manager_id = $2',
            [truckId, fleetManagerId]
        );
        if (res.rowCount === 0) {
            throw createTripError('Truck does not exist or does not belong to the given fleet manager.', 403);
        }
        return res.rows[0].id;
    }

    if (truckNumber) {
        const res = await client.query(
            'SELECT id FROM trucks WHERE fleet_manager_id = $1 AND LOWER(truck_number) = LOWER($2)',
            [fleetManagerId, truckNumber]
        );
        if (res.rowCount > 0) {
            return res.rows[0].id;
        }

        // Fallback: If not found as a number string, and it looks like an integer, try matching by ID
        const maybeId = toIntegerOrNull(truckNumber);
        if (maybeId !== null) {
            const idRes = await client.query(
                'SELECT id FROM trucks WHERE id = $1 AND fleet_manager_id = $2',
                [maybeId, fleetManagerId]
            );
            if (idRes.rowCount > 0) {
                return idRes.rows[0].id;
            }
        }

        throw createTripError(`Truck '${truckNumber}' not found or does not belong to Fleet Manager ID '${fleetManagerId}'.`, 403);
    }

    throw createTripError('truck_id or truck_number is required.');
}

/**
 * Validates input and resolves truck_number → truck_id. Call inside a transaction.
 * @param {import('pg').PoolClient} client
 * @param {Record<string, unknown>} input
 */
export async function prepareTripPayload(client, input = {}) {
    const fleetManagerId = toIntegerOrNull(input.fleet_manager_id);
    if (fleetManagerId === null) {
        throw createTripError('fleet_manager_id is required.');
    }

    const source_lat = toFiniteNumber(input.source_lat);
    const source_lng = toFiniteNumber(input.source_lng);
    const dest_lat = toFiniteNumber(input.dest_lat);
    const dest_lng = toFiniteNumber(input.dest_lng);

    if (source_lat === null || source_lng === null || dest_lat === null || dest_lng === null) {
        throw createTripError('source_lat, source_lng, dest_lat, and dest_lng are required.');
    }

    assertCoordinateBounds(source_lat, source_lng, dest_lat, dest_lng);

    let deadlineTimestamp = null;
    if (input.deadline_timestamp !== null && input.deadline_timestamp !== undefined && input.deadline_timestamp !== '') {
        deadlineTimestamp = parseDeadline(input.deadline_timestamp);
    }

    const truck_id = await resolveTruckIdForFleet(client, fleetManagerId, input.truck_id, input.truck_number);

    return {
        fleet_manager_id: fleetManagerId,
        truck_id,
        source_lat,
        source_lng,
        dest_lat,
        dest_lng,
        deadline_timestamp: deadlineTimestamp,
    };
}

/**
 * Inserts trip, fetches routes, inserts route rows, sets baseline. Caller must manage transaction.
 * @param {import('pg').PoolClient} client
 * @param {Awaited<ReturnType<typeof prepareTripPayload>>} payload
 */
export async function createTripWithRoutes(client, payload) {
    const { fleet_manager_id, truck_id, source_lat, source_lng, dest_lat, dest_lng, deadline_timestamp } = payload;

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
        deadline_timestamp,
    ]);

    const trip = result.rows[0];
    const trip_id = trip.id;

    let fetchedRoutes = [];
    try {
        fetchedRoutes = await getRoutes(source_lat, source_lng, dest_lat, dest_lng);
    } catch (routeErr) {
        console.error('Failed to fetch routes from Google API:', routeErr);
        // During bulk upload or if API fails, we might want to still allow trip creation
        // but mark it as needing route calculation later, or just return the trip.
        // For now, we follow the truck upload pattern where we try to persist as much as possible.
        return { trip, total_routes: 0, route_error: routeErr.message };
    }

    if (!fetchedRoutes || fetchedRoutes.length === 0) {
        return { trip, total_routes: 0 };
    }

    const routeMapping = {};
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (let i = 0; i < fetchedRoutes.length; i += 1) {
        const r = fetchedRoutes[i];
        const routeIndex = alphabet[i] || `R${i}`;

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
            r.hasTolls,
        ]);

        routeMapping[routeIndex] = routeRes.rows[0].id;
    }

    if (routeMapping.A && fetchedRoutes[0]) {
        const baselineRouteId = routeMapping.A;
        const baselineDuration = fetchedRoutes[0].durationSeconds;
        const baselineDistance = fetchedRoutes[0].distanceMeters;

        const updateTripQuery = `
            UPDATE trips
            SET current_route_id = $1, baseline_eta_seconds = $2, baseline_distance_meters = $3
            WHERE id = $4
        `;
        await client.query(updateTripQuery, [baselineRouteId, baselineDuration, baselineDistance, trip_id]);

        trip.current_route_id = baselineRouteId;
        trip.baseline_eta_seconds = baselineDuration;
        trip.baseline_distance_meters = baselineDistance;
    }

    return { trip, total_routes: fetchedRoutes.length };
}

/**
 * Full transactional create (API + Excel). Releases its own client from pool.
 * @param {import('pg').Pool} pool
 */
export async function insertTripRecord(pool, input) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const payload = await prepareTripPayload(client, input);
        const { trip, total_routes } = await createTripWithRoutes(client, payload);
        await client.query('COMMIT');
        return {
            trip_id: trip.id,
            baseline_route: {
                route_id: trip.current_route_id || null,
                eta_seconds: trip.baseline_eta_seconds || null,
                distance_meters: trip.baseline_distance_meters || null,
            },
            total_routes,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
