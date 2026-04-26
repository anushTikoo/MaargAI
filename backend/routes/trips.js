import express from 'express';
import pool from '../db.js';
import { getRoutes } from '../services/routesService.js';
import realtimeDB from '../services/firebase.js';
import { decodePolyline, segmentRoute } from '../services/segmentationService.js';
import { fetchSegmentTrafficDurations } from '../services/trafficService.js';
import { fetchSegmentWeatherScores } from '../services/weatherService.js';
import { getAIRouteRecommendation } from '../services/geminiService.js';

const router = express.Router();
const START_TRIP_RADIUS_METERS = 250;

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
    const earthRadiusMeters = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const startLat = toRadians(lat1);
    const endLat = toRadians(lat2);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(startLat) * Math.cos(endLat) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
}

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
                r.has_tolls AS current_route_has_tolls,
                r.toll_cost AS current_route_toll_cost,
                r.is_ai_recommended AS current_route_is_ai_recommended,
                r.ai_total_cost_inr AS current_route_ai_total_cost_inr,
                r.ai_slack_time_hours AS current_route_ai_slack_time_hours,
                r.ai_risk_level AS current_route_ai_risk_level
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

// GET /api/trips/active-map?fleet_manager_id=123
// Returns all active trips for map rendering.
router.get('/active-map', async (req, res) => {
    try {
        const { fleet_manager_id } = req.query;

        if (!fleet_manager_id) {
            return res.status(400).json({ error: 'fleet_manager_id is required.' });
        }

        const parsedFleetManagerId = Number(fleet_manager_id);

        if (!Number.isInteger(parsedFleetManagerId) || parsedFleetManagerId <= 0) {
            return res.status(400).json({ error: 'fleet_manager_id must be a positive integer.' });
        }

        const activeTripsResult = await pool.query(
            `SELECT
                t.id,
                t.fleet_manager_id,
                t.truck_id,
                tr.truck_number,
                t.status,
                t.source,
                t.destination,
                t.source_lat,
                t.source_lng,
                t.dest_lat,
                t.dest_lng,
                t.created_at,
                COALESCE(current_route.id, fallback_route.id) AS route_id,
                COALESCE(current_route.route_index, fallback_route.route_index) AS route_index,
                COALESCE(current_route.polyline, fallback_route.polyline) AS polyline,
                COALESCE(current_route.distance_meters, fallback_route.distance_meters) AS distance_meters,
                COALESCE(current_route.duration_seconds, fallback_route.duration_seconds) AS duration_seconds,
                COALESCE(current_route.has_tolls, fallback_route.has_tolls) AS has_tolls,
                COALESCE(current_route.toll_cost, fallback_route.toll_cost) AS toll_cost,
                COALESCE(current_route.is_ai_recommended, fallback_route.is_ai_recommended) AS is_ai_recommended,
                COALESCE(current_route.ai_total_cost_inr, fallback_route.ai_total_cost_inr) AS ai_total_cost_inr,
                COALESCE(current_route.ai_slack_time_hours, fallback_route.ai_slack_time_hours) AS ai_slack_time_hours,
                COALESCE(current_route.ai_risk_level, fallback_route.ai_risk_level) AS ai_risk_level
            FROM trips t
            JOIN trucks tr ON tr.id = t.truck_id
            LEFT JOIN routes current_route ON current_route.id = t.current_route_id
            LEFT JOIN LATERAL (
                SELECT id, route_index, polyline, distance_meters, duration_seconds, has_tolls, toll_cost, is_ai_recommended, ai_total_cost_inr, ai_slack_time_hours, ai_risk_level
                FROM routes
                WHERE trip_id = t.id
                ORDER BY route_index ASC
                LIMIT 1
            ) AS fallback_route ON TRUE
            WHERE t.fleet_manager_id = $1
              AND t.status = 'active'
            ORDER BY t.created_at DESC`,
            [parsedFleetManagerId]
        );

        if (activeTripsResult.rowCount === 0) {
            return res.status(200).json({ trips: [] });
        }

        const trips = activeTripsResult.rows.map((activeTrip) => ({
            id: activeTrip.id,
            fleet_manager_id: activeTrip.fleet_manager_id,
            truck_id: activeTrip.truck_id,
            truck_number: activeTrip.truck_number,
            status: activeTrip.status,
            source: activeTrip.source,
            destination: activeTrip.destination,
            source_lat: activeTrip.source_lat,
            source_lng: activeTrip.source_lng,
            dest_lat: activeTrip.dest_lat,
            dest_lng: activeTrip.dest_lng,
            created_at: activeTrip.created_at,
            route: activeTrip.route_id
                ? {
                    id: activeTrip.route_id,
                    route_index: activeTrip.route_index,
                    polyline: activeTrip.polyline,
                    distance_meters: activeTrip.distance_meters,
                    duration_seconds: activeTrip.duration_seconds,
                    has_tolls: activeTrip.has_tolls,
                    toll_cost: activeTrip.has_tolls
                        ? (parseFloat(activeTrip.toll_cost) > 0 ? parseFloat(activeTrip.toll_cost) : null)
                        : 0,
                    is_ai_recommended: activeTrip.is_ai_recommended,
                    ai_total_cost_inr: activeTrip.ai_total_cost_inr,
                    ai_slack_time_hours: activeTrip.ai_slack_time_hours,
                    ai_risk_level: activeTrip.ai_risk_level
                }
                : null,
        }));

        const tripsWithLiveLocations = await Promise.all(
            trips.map(async (trip) => {
                try {
                    const locationSnapshot = await realtimeDB
                        .ref(`fleet_managers/${trip.fleet_manager_id}/${trip.id}`)
                        .once('value');

                    const location = locationSnapshot.val();
                    const lat = Number(location?.lat);
                    const lng = Number(location?.lng);

                    const isValidLiveLocation =
                        Number.isFinite(lat) &&
                        Number.isFinite(lng) &&
                        lat >= -90 &&
                        lat <= 90 &&
                        lng >= -180 &&
                        lng <= 180;

                    if (!isValidLiveLocation) {
                        return null;
                    }

                    return {
                        ...trip,
                        live_location: {
                            lat,
                            lng,
                            timestamp: Number(location?.timestamp) || null,
                        },
                    };
                } catch (firebaseError) {
                    console.error(`Error fetching live location for trip ${trip.id}:`, firebaseError);
                    return null;
                }
            })
        );

        return res.status(200).json({
            trips: tripsWithLiveLocations.filter(Boolean),
        });
    } catch (error) {
        console.error('Error fetching active map trip:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

/**
 * GET /api/trips/:id/intelligence
 * Compares ALL routes for a trip using segment-level traffic analysis.
 * Returns per-route metrics (avg_delay, max_delay, congestion_density)
 * and recommends the best route based on lowest avg_delay.
 */
router.get('/:id/intelligence', async (req, res) => {
    try {
        const { id } = req.params;
        const tripId = parseInt(id);

        if (isNaN(tripId)) {
            return res.status(400).json({ error: 'Invalid trip ID.' });
        }

        // 1. Verify trip exists and get current route + truck mileage
        const tripRes = await pool.query(
            `SELECT t.id, t.current_route_id, t.deadline_timestamp, tr.mileage_kmpl
             FROM trips t
             JOIN trucks tr ON tr.id = t.truck_id
             WHERE t.id = $1`,
            [tripId]
        );

        if (tripRes.rowCount === 0) {
            return res.status(404).json({ error: 'Trip not found.' });
        }

        const currentRouteId = tripRes.rows[0].current_route_id;
        const tripDeadline = tripRes.rows[0].deadline_timestamp; // Might be null
        const truckMileage = parseFloat(tripRes.rows[0].mileage_kmpl) || 4.0;
        const FUEL_PRICE_PER_LITRE = 90;

        // 2. Fetch ALL routes for this trip, ordered by route_index (A, B, C...)
        const routesRes = await pool.query(
            `SELECT id, route_index, distance_meters, duration_seconds, has_tolls, toll_cost
             FROM routes
             WHERE trip_id = $1
             ORDER BY route_index ASC`,
            [tripId]
        );

        if (routesRes.rowCount === 0) {
            return res.status(200).json({
                trip_id: tripId,
                current_route_id: currentRouteId,
                routes: [],
                recommended_route_id: null,
                message: 'No routes found for this trip.'
            });
        }

        // 3. For each route, fetch its segments and compute metrics
        const routeAnalyses = await Promise.all(
            routesRes.rows.map(async (route) => {
                const segmentsRes = await pool.query(
                    `SELECT
                        segment_index, start_lat, start_lng, end_lat, end_lng,
                        distance_meters, duration_in_traffic_seconds, delay_ratio,
                        traffic_checked_at, points_json,
                        weather_score, weather_main
                     FROM trip_segments
                     WHERE route_id = $1
                     ORDER BY segment_index ASC`,
                    [route.id]
                );

                const segments = segmentsRes.rows;

                // Traffic metrics
                const validRatios = segments
                    .map(s => parseFloat(s.delay_ratio))
                    .filter(r => Number.isFinite(r));

                // Weather metrics
                const validWeather = segments
                    .map(s => parseFloat(s.weather_score))
                    .filter(w => Number.isFinite(w));

                let metrics = {
                    avg_delay: null,
                    max_delay: null,
                    congestion_density: null,
                    avg_weather: null,
                    max_weather: null,
                    reliability_score: null,
                    reliability_status: 'pending',
                    total_segments: segments.length,
                    analyzed_segments: validRatios.length,
                    weather_analyzed_segments: validWeather.length,
                };

                if (validRatios.length > 0) {
                    const sum = validRatios.reduce((a, b) => a + b, 0);
                    metrics.avg_delay = parseFloat((sum / validRatios.length).toFixed(3));
                    metrics.max_delay = parseFloat(Math.max(...validRatios).toFixed(3));

                    // Density: fraction of segments where delay_ratio > 1.5 (Heavy congestion)
                    const congestedCount = validRatios.filter(r => r > 1.5).length;
                    metrics.congestion_density = parseFloat((congestedCount / validRatios.length).toFixed(3));
                }

                if (validWeather.length > 0) {
                    const weatherSum = validWeather.reduce((a, b) => a + b, 0);
                    metrics.avg_weather = parseFloat((weatherSum / validWeather.length).toFixed(3));
                    metrics.max_weather = parseFloat(Math.max(...validWeather).toFixed(3));
                }

                // Reliability Score (Maarg Index)
                // Only compute if at least one category of data is available.
                // Traffic: use excess delay (ratio - 1) so a perfectly on-time route contributes 0.
                // Weather: raw score already starts at 0 for clear/calm conditions.
                // Thresholds: 0–0.3 stable | 0.3–0.7 risky | 0.7+ unstable
                const hasTraffic = metrics.avg_delay !== null;
                const hasWeather = metrics.avg_weather !== null;

                if (hasTraffic || hasWeather) {
                    const excessAvg = hasTraffic ? Math.max(0, metrics.avg_delay - 1) : 0;
                    const excessMax = hasTraffic ? Math.max(0, metrics.max_delay - 1) : 0;
                    const density = hasTraffic ? metrics.congestion_density : 0;
                    const avgWeather = hasWeather ? metrics.avg_weather : 0;
                    const maxWeather = hasWeather ? metrics.max_weather : 0;

                    const trafficRisk = (excessAvg * 0.40) + (excessMax * 0.30) + (density * 0.20);
                    const weatherRisk = (avgWeather * 0.10) + (maxWeather * 0.30);

                    const raw = trafficRisk + weatherRisk;
                    metrics.reliability_score = parseFloat(raw.toFixed(3));

                    if (raw < 0.3) {
                        metrics.reliability_status = 'stable';
                    } else if (raw < 0.7) {
                        metrics.reliability_status = 'risky';
                    } else {
                        metrics.reliability_status = 'unstable';
                    }
                }

                // --- NEW CALCULATIONS ---
                const fuelCost = (route.distance_meters / 1000 / truckMileage) * FUEL_PRICE_PER_LITRE;

                // Deadline Analysis (Slack Time)
                let deadlineAnalysis = null;
                if (tripDeadline) {
                    const trafficMultiplier = metrics.avg_delay || 1.0;
                    const adjustedDurationSec = route.duration_seconds * trafficMultiplier;

                    const now = new Date();
                    const etaDate = new Date(now.getTime() + (adjustedDurationSec * 1000));
                    const deadlineDate = new Date(tripDeadline);

                    const slackMs = deadlineDate.getTime() - etaDate.getTime();
                    const slackHours = parseFloat((slackMs / 3600000).toFixed(2));

                    let status = 'on_track';
                    if (slackHours < 0) {
                        status = 'late';
                    } else if (slackHours <= 0.25) { // 0.25h = 15m
                        status = 'critical';
                    }

                    deadlineAnalysis = {
                        predicted_arrival: etaDate.toISOString(),
                        slack_time_hours: slackHours,
                        status: status
                    };
                }

                return {
                    route_id: route.id,
                    route_index: route.route_index,
                    distance_km: parseFloat((route.distance_meters / 1000).toFixed(2)),
                    duration_hours: parseFloat((route.duration_seconds / 3600).toFixed(2)),
                    has_tolls: route.has_tolls,
                    toll_cost_inr: route.has_tolls
                        ? (parseFloat(route.toll_cost) > 0 ? parseFloat(route.toll_cost) : "not available")
                        : 0,
                    fuel_cost_inr: parseFloat(fuelCost.toFixed(2)),
                    is_current: route.id === currentRouteId,
                    metrics: {
                        ...metrics,
                        deadline_analysis: deadlineAnalysis
                    },
                    segments
                };
            })
        );

        return res.status(200).json({
            trip_id: tripId,
            current_route_id: currentRouteId,
            routes: routeAnalyses
        });

    } catch (error) {
        console.error('Error fetching trip intelligence:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

/**
 * Async helper: enrich all segment rows for every route of a trip
 * with real-time traffic (delay_ratio) and weather scores.
 * Called fire-and-forget on trip activation.
 */
async function enrichTripSegments(tripId) {
    console.log(`[Enrichment] Starting for trip ${tripId}...`);

    const routesRes = await pool.query(
        `SELECT r.id AS route_id, r.duration_seconds
         FROM routes r
         WHERE r.trip_id = $1
         ORDER BY r.route_index ASC`,
        [tripId]
    );

    console.log(`[Enrichment] Found ${routesRes.rowCount} route(s) for trip ${tripId}.`);

    for (const route of routesRes.rows) {
        try {
            const segRes = await pool.query(
                `SELECT id, segment_index, start_lat, start_lng, end_lat, end_lng
                 FROM trip_segments
                 WHERE route_id = $1
                 ORDER BY segment_index ASC`,
                [route.route_id]
            );

            const segments = segRes.rows;
            console.log(`[Enrichment] Route ${route.route_id}: ${segments.length} segment(s) found.`);

            if (segments.length === 0) continue;

            const avgSegmentTime = route.duration_seconds / segments.length;

            // --- Traffic ---
            let trafficDurations = new Array(segments.length).fill(null);
            try {
                trafficDurations = await fetchSegmentTrafficDurations(segments);
            } catch (err) {
                console.warn(`[Enrichment] Traffic failed for route ${route.route_id}:`, err.message);
            }

            // --- Weather ---
            let weatherResults = new Array(segments.length).fill(null);
            try {
                weatherResults = await fetchSegmentWeatherScores(segments);
            } catch (err) {
                console.warn(`[Enrichment] Weather failed for route ${route.route_id}:`, err.message);
            }

            const trafficCheckedAt = new Date().toISOString();

            // Update each segment row
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const durationInTraffic = trafficDurations[i];
                const delayRatio = (durationInTraffic !== null && avgSegmentTime > 0)
                    ? parseFloat((durationInTraffic / avgSegmentTime).toFixed(3))
                    : null;
                const weatherScore = weatherResults[i]?.score ?? null;
                const weatherMain = weatherResults[i]?.weather_main ?? null;

                await pool.query(
                    `UPDATE trip_segments
                     SET duration_in_traffic_seconds = $1,
                         delay_ratio                 = $2,
                         traffic_checked_at          = $3,
                         weather_score               = $4,
                         weather_main                = $5
                     WHERE id = $6`,
                    [durationInTraffic, delayRatio, trafficCheckedAt, weatherScore, weatherMain, seg.id]
                );
            }

            console.log(`[Enrichment] Route ${route.route_id}: ${segments.length} segments updated.`);
        } catch (routeErr) {
            console.error(`[Enrichment] Error processing route ${route.route_id}:`, routeErr.message);
            // Continue to the next route even if this one fails
        }
    }

    console.log(`[Enrichment] Complete for trip ${tripId}.`);

    // --- AI RECOMMENDATION ---
    // After all segments are enriched, pull computed metrics per route
    // and ask Gemini to pick the best one.
    try {
        const tripMeta = await pool.query(
            `SELECT t.deadline_timestamp, tr.mileage_kmpl
             FROM trips t
             JOIN trucks tr ON tr.id = t.truck_id
             WHERE t.id = $1`,
            [tripId]
        );

        const deadlineTs = tripMeta.rows[0]?.deadline_timestamp ?? null;
        const mileageKmpl = parseFloat(tripMeta.rows[0]?.mileage_kmpl) || 4.0;
        const FUEL_PRICE = 90;

        const allRoutesRes = await pool.query(
            `SELECT
                r.id,
                r.route_index,
                r.distance_meters,
                r.duration_seconds,
                r.has_tolls,
                r.toll_cost,
                COALESCE(AVG(ts.delay_ratio), null)        AS avg_delay,
                COALESCE(AVG(ts.weather_score), null)      AS avg_weather,
                COALESCE(MAX(ts.weather_score), null)      AS max_weather,
                COALESCE(MAX(ts.delay_ratio), null)        AS max_delay,
                COUNT(CASE WHEN ts.delay_ratio > 1.5 THEN 1 END)::float /
                    NULLIF(COUNT(ts.id), 0)                AS congestion_density
             FROM routes r
             LEFT JOIN trip_segments ts ON ts.route_id = r.id
             WHERE r.trip_id = $1
             GROUP BY r.id
             ORDER BY r.route_index ASC`,
            [tripId]
        );

        const geminiPayload = allRoutesRes.rows.map((r) => {
            const avgDelay   = parseFloat(r.avg_delay)   || 1.0;
            const maxDelay   = parseFloat(r.max_delay)   || 1.0;
            const density    = parseFloat(r.congestion_density) || 0;
            const avgWeather = parseFloat(r.avg_weather) || 0;
            const maxWeather = parseFloat(r.max_weather) || 0;

            const excessAvg  = Math.max(0, avgDelay - 1);
            const excessMax  = Math.max(0, maxDelay - 1);
            const reliability = parseFloat(
                ((excessAvg * 0.40) + (excessMax * 0.30) + (density * 0.20)
                + (avgWeather * 0.10) + (maxWeather * 0.30)).toFixed(3)
            );

            const etaHours = parseFloat((r.duration_seconds * avgDelay / 3600).toFixed(2));
            const fuelCostInr = parseFloat(((r.distance_meters / 1000 / mileageKmpl) * FUEL_PRICE).toFixed(2));
            const tollCostInr = r.has_tolls
                ? (parseFloat(r.toll_cost) > 0 ? parseFloat(r.toll_cost) : null)
                : 0;

            let slackHours = null;
            if (deadlineTs) {
                const adjustedDurMs = r.duration_seconds * avgDelay * 1000;
                const eta = new Date(Date.now() + adjustedDurMs);
                slackHours = parseFloat(((new Date(deadlineTs) - eta) / 3600000).toFixed(2));
            }

            return {
                id: r.route_index,
                eta_hours: etaHours,
                fuel_cost_inr: fuelCostInr,
                toll_cost_inr: tollCostInr,
                reliability_score: reliability,
                slack_time_hours: slackHours
            };
        });

        const recommendation = await getAIRouteRecommendation(geminiPayload);
        const selectedIndex  = recommendation.selected_route;

        // Reset all flags then set the winner
        await pool.query('UPDATE routes SET is_ai_recommended = FALSE WHERE trip_id = $1', [tripId]);
        await pool.query(
            `UPDATE routes 
             SET is_ai_recommended = TRUE,
                 ai_total_cost_inr = $3,
                 ai_slack_time_hours = $4,
                 ai_risk_level = $5
             WHERE trip_id = $1 AND route_index = $2`,
            [
                tripId, 
                selectedIndex,
                recommendation.summary?.total_cost_inr || null,
                recommendation.summary?.slack_time_hours || null,
                recommendation.summary?.risk_level || null
            ]
        );

        // Also update current_route_id on the trip so the map shows the right one
        const winnerRes = await pool.query(
            'SELECT id FROM routes WHERE trip_id = $1 AND route_index = $2',
            [tripId, selectedIndex]
        );
        if (winnerRes.rowCount > 0) {
            await pool.query(
                'UPDATE trips SET current_route_id = $1 WHERE id = $2',
                [winnerRes.rows[0].id, tripId]
            );
        }

        console.log(`[Gemini] Trip ${tripId}: AI selected route ${selectedIndex}. Flag saved.`);
    } catch (geminiErr) {
        console.error(`[Gemini] Recommendation failed for trip ${tripId}:`, geminiErr.message);
        // Non-fatal — enrichment still succeeded; route just won't have a flag yet
    }
}


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
            `SELECT id, trip_id, route_index, polyline, distance_meters, duration_seconds, has_tolls, toll_cost, created_at
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

// POST /api/trips/locations
router.post('/locations', async (req, res) => {
    try {
        const { token, lat, lng } = req.body;
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        const parsedLat = Number(lat);
        const parsedLng = Number(lng);

        if (!normalizedToken) {
            return res.status(400).json({ error: 'token is required.' });
        }

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ error: 'lat and lng are required.' });
        }

        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
            return res.status(400).json({ error: 'lat and lng must be valid numbers.' });
        }

        if (parsedLat < -90 || parsedLat > 90) {
            return res.status(400).json({ error: 'lat must be between -90 and 90.' });
        }

        if (parsedLng < -180 || parsedLng > 180) {
            return res.status(400).json({ error: 'lng must be between -180 and 180.' });
        }

        const truckResult = await pool.query(
            'SELECT id FROM trucks WHERE truck_number = $1',
            [normalizedToken]
        );

        if (truckResult.rowCount === 0) {
            return res.status(404).json({ error: 'Truck not found for the provided token.' });
        }

        const truckId = truckResult.rows[0].id;

        const tripResult = await pool.query(
            `SELECT id, fleet_manager_id, status, source_lat, source_lng
             FROM trips
             WHERE truck_id = $1
               AND status IN ('not started', 'active')
             ORDER BY created_at DESC
             LIMIT 1`,
            [truckId]
        );

        if (tripResult.rowCount === 0) {
            return res.status(404).json({ error: 'No active trip found for this truck.' });
        }

        const tripId = tripResult.rows[0].id;
        const fleetManagerId = tripResult.rows[0].fleet_manager_id;
        const currentTripStatus = tripResult.rows[0].status;
        const sourceLat = Number(tripResult.rows[0].source_lat);
        const sourceLng = Number(tripResult.rows[0].source_lng);

        const distanceToSourceMeters = Number.isFinite(sourceLat) && Number.isFinite(sourceLng)
            ? calculateDistanceMeters(parsedLat, parsedLng, sourceLat, sourceLng)
            : null;

        let startedNow = false;
        let nextTripStatus = currentTripStatus;

        if (
            currentTripStatus === 'not started' &&
            Number.isFinite(distanceToSourceMeters) &&
            distanceToSourceMeters <= START_TRIP_RADIUS_METERS
        ) {
            const activateTripResult = await pool.query(
                `UPDATE trips
                 SET status = 'active'
                 WHERE id = $1
                   AND status = 'not started'
                 RETURNING status`,
                [tripId]
            );

            if (activateTripResult.rowCount > 0) {
                startedNow = true;
                nextTripStatus = activateTripResult.rows[0].status;

                // Fire-and-forget: enrich all segments for this trip with real-time
                // traffic + weather data now that the trip is actually starting.
                enrichTripSegments(tripId).catch((err) =>
                    console.error(`[Enrichment] Failed for trip ${tripId}:`, err.message)
                );
            }
        }

        const locationResult = await pool.query(
            `INSERT INTO trip_locations (trip_id, lat, lng)
             VALUES ($1, $2, $3)
             RETURNING id, trip_id, lat, lng, timestamp`,
            [tripId, parsedLat, parsedLng]
        );

        const shouldSyncLiveLocation = nextTripStatus === 'active';

        // push to firebase (LIVE) only for active trips
        if (shouldSyncLiveLocation) {
            await realtimeDB
                .ref(`fleet_managers/${fleetManagerId}/${tripId}`)
                .set({
                    lat: parsedLat,
                    lng: parsedLng,
                    timestamp: Date.now()
                });
        }

        return res.status(201).json({
            message: 'Trip location saved successfully.',
            location: locationResult.rows[0],
            trip: {
                id: tripId,
                fleet_manager_id: fleetManagerId,
                status: nextTripStatus,
                started_now: startedNow,
                distance_to_source_meters: Number.isFinite(distanceToSourceMeters)
                    ? Number(distanceToSourceMeters.toFixed(2))
                    : null,
                start_radius_meters: START_TRIP_RADIUS_METERS,
                live_location_synced: shouldSyncLiveLocation,
            },
        });
    } catch (error) {
        console.error('Error saving trip location:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/trips/:trip_id/locations
router.get('/:trip_id/locations', async (req, res) => {
    try {
        const { trip_id } = req.params;

        const parsedTripId = Number(trip_id);

        if (!Number.isInteger(parsedTripId) || parsedTripId <= 0) {
            return res.status(400).json({ error: 'trip_id must be a positive integer.' });
        }

        const tripCheck = await pool.query('SELECT id FROM trips WHERE id = $1', [parsedTripId]);

        if (tripCheck.rowCount === 0) {
            return res.status(404).json({ error: 'Trip not found.' });
        }

        const locationsResult = await pool.query(
            `SELECT trip_id, lat, lng, timestamp
             FROM trip_locations
             WHERE trip_id = $1
             ORDER BY timestamp ASC, id ASC`,
            [parsedTripId]
        );

        return res.status(200).json({
            trip_id: parsedTripId,
            locations: locationsResult.rows,
        });
    } catch (error) {
        console.error('Error fetching trip locations:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/trips/test-routes?source_lat=...&source_lng=...&dest_lat=...&dest_lng=...
router.get('/test-routes', async (req, res) => {
    try {
        const { source_lat, source_lng, dest_lat, dest_lng } = req.query;

        if (!source_lat || !source_lng || !dest_lat || !dest_lng) {
            return res.status(400).json({ error: 'source_lat, source_lng, dest_lat, and dest_lng are required.' });
        }

        const routes = await getRoutes(
            parseFloat(source_lat),
            parseFloat(source_lng),
            parseFloat(dest_lat),
            parseFloat(dest_lng)
        );

        return res.status(200).json({ routes });
    } catch (error) {
        console.error('Error in test-routes:', error);
        return res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error.' });
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
                        trip_id, route_index, polyline, distance_meters, duration_seconds, has_tolls, toll_cost
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id;
                `;

                const routeRes = await client.query(insertRouteQuery, [
                    trip_id,
                    routeIndex,
                    r.polyline,
                    r.distanceMeters,
                    r.durationSeconds,
                    r.hasTolls,
                    r.tollCost
                ]);

                // Store mapping: index -> route_id
                const currentRouteId = routeRes.rows[0].id;
                routeMapping[routeIndex] = currentRouteId;

                // Segment geometry: stored at creation time (no API calls here)
                // Traffic + weather enrichment happens when the trip goes active.
                if (r.polyline) {
                    const decodedPoints = decodePolyline(r.polyline);
                    const targetSegmentKm = Math.max(8, Math.min(20, (r.distanceMeters / 1000) / 10));
                    const segments = segmentRoute(decodedPoints, targetSegmentKm);

                    if (segments.length > 0) {
                        // Bulk insert geometry-only segments (traffic/weather filled later on activation)
                        const valuePlaceholders = [];
                        const valueParams = [];
                        let pIdx = 1;

                        for (let sIdx = 0; sIdx < segments.length; sIdx++) {
                            const seg = segments[sIdx];
                            valuePlaceholders.push(
                                `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
                            );
                            valueParams.push(
                                currentRouteId,
                                sIdx,
                                seg.start_lat,
                                seg.start_lng,
                                seg.end_lat,
                                seg.end_lng,
                                seg.distance,
                                JSON.stringify(seg.points)
                            );
                        }

                        const bulkInsertQuery = `
                            INSERT INTO trip_segments (
                                route_id, segment_index,
                                start_lat, start_lng, end_lat, end_lng,
                                distance_meters, points_json
                            ) VALUES ${valuePlaceholders.join(', ')}
                        `;
                        await client.query(bulkInsertQuery, valueParams);
                    }
                }
            }

            // Phase 5: Task 11 & 12 - Select Baseline Route & Update Trip
            // Google's best route is always the first one (index 'A'). We only set baseline metrics.
            // current_route_id remains NULL until Gemini makes a decision.
            if (routeMapping['A'] && fetchedRoutes[0]) {
                const baselineDuration = fetchedRoutes[0].durationSeconds;
                const baselineDistance = fetchedRoutes[0].distanceMeters;

                const updateTripQuery = `
                    UPDATE trips
                    SET baseline_eta_seconds = $1, baseline_distance_meters = $2
                    WHERE id = $3
                `;
                await client.query(updateTripQuery, [baselineDuration, baselineDistance, trip_id]);

                // Update in-memory reference to send accurately back in response
                trip.baseline_eta_seconds = baselineDuration;
                trip.baseline_distance_meters = baselineDistance;
                trip.current_route_id = null;
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
