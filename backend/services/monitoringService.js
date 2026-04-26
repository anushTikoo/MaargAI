import pool from '../db.js';
import { getAIRouteRecommendation, evaluateTripAnomaly } from './geminiService.js';
import { getRoutes } from './routesService.js';
import { getRouteFromCache } from './agentTools.js';


/**
 * Main monitoring loop logic.
 * Fetches active trips and re-calculates their status.
 */
export async function processActiveTrips() {
    console.log('[Worker] Starting monitoring loop...');
    const startTime = Date.now();

    try {
        // 1. Fetch active trips that have a current route
        const { rows: trips } = await pool.query(`
            SELECT t.*, tr.mileage_kmpl, r.polyline, r.distance_meters as route_distance, r.duration_seconds as route_duration
            FROM trips t
            JOIN trucks tr ON t.truck_id = tr.id
            LEFT JOIN routes r ON t.current_route_id = r.id
            WHERE t.status = 'active' AND t.current_route_id IS NOT NULL
        `);

        console.log(`[Worker] Found ${trips.length} active trips to process.`);

        for (const trip of trips) {
            await processSingleTrip(trip);
        }

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[Worker] Loop completed in ${duration}s.`);
        return { processed: trips.length, duration };

    } catch (err) {
        console.error('[Worker] Error in monitoring loop:', err);
        throw err;
    }
}

/**
 * Process a single trip: re-calculate ETA and check for anomalies.
 */
async function processSingleTrip(trip) {
    const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
    
    // In a real scenario, we'd get the truck's LIVE GPS.
    // For the demo, we use the last recorded GPS or source.
    const currentLat = trip.last_gps_lat || trip.source_lat;
    const currentLng = trip.last_gps_lng || trip.source_lng;

    try {
        // Optimization: Only re-calculate ETA if a delay was injected or GPS was warped
        // This prevents wasteful API calls during the "idle" monitoring state.
        if (!trip.simulated_delay_seconds && !trip.last_gps_lat) {
            return;
        }

        // 2. Re-calculate ETA from CURRENT position to DESTINATION using Routes API v2
        const routes = await getRoutes(currentLat, currentLng, trip.dest_lat, trip.dest_lng);

        if (!routes || routes.length === 0) {
            console.warn(`[Worker] Failed to get valid routing data for trip ${trip.id}.`);
            return;
        }

        // Taking the first (best) route returned
        const liveEtaSeconds = routes[0].durationSeconds;
        const liveDistanceMeters = routes[0].distanceMeters;

        // 3. Calculate Delay
        // Predicted Arrival = Current Time + Live ETA
        // Planned Arrival = Created At + Baseline ETA
        const createdAtMs = new Date(trip.created_at).getTime();
        const plannedArrivalMs = createdAtMs + (trip.baseline_eta_seconds * 1000);
        const predictedArrivalMs = Date.now() + (liveEtaSeconds * 1000);
        
        // Total delay is (Predicted - Planned) + any artificial chaos we injected
        const totalDelaySeconds = Math.floor((predictedArrivalMs - plannedArrivalMs) / 1000) + (trip.simulated_delay_seconds || 0);
        const delayMinutes = Math.floor(totalDelaySeconds / 60);

        console.log(`[Worker] Trip ${trip.id} | Predicted Delay: ${delayMinutes} mins (Simulated: ${trip.simulated_delay_seconds / 60}m)`);

        // 4. Save Checkpoint
        // Map the string risk level to a numerical score for the checkpoints table
        const riskMap = { 'low': 0.1, 'medium': 0.4, 'high': 0.8 };
        const numericalRisk = riskMap[trip.ai_risk_level] || 0.0;

        await pool.query(`
            INSERT INTO trip_checkpoints (trip_id, lat, lng, current_delay_seconds, estimated_remaining_seconds, risk_score)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [trip.id, currentLat, currentLng, totalDelaySeconds, liveEtaSeconds, numericalRisk]);

        // 5. Update Trip Last Checked, Live ETA, Live Distance, and Live Slack
        let liveSlackTimeHours = null;
        if (trip.deadline_timestamp) {
            const etaDate = new Date(Date.now() + (liveEtaSeconds * 1000));
            const deadlineDate = new Date(trip.deadline_timestamp);
            const slackMs = deadlineDate.getTime() - etaDate.getTime();
            liveSlackTimeHours = parseFloat((slackMs / 3600000).toFixed(2));
        }

        await pool.query(`
            UPDATE trips 
            SET last_checked_at = CURRENT_TIMESTAMP, 
                live_eta_seconds = $1,
                live_distance_meters = $2,
                live_slack_time_hours = $3
            WHERE id = $4
        `, [liveEtaSeconds, liveDistanceMeters, liveSlackTimeHours, trip.id]);

        // 6. TRIGGER ENGINE (Layer 2)
        // Only call AI if delay is significant (> 15 mins)
        if (delayMinutes > 15) {
            console.log(`[Worker] 🚨 ANOMALY DETECTED for Trip ${trip.id} (Delay: ${delayMinutes}m). Waking up Gemini...`);
            
            const currentRouteStats = {
                distance_meters: liveDistanceMeters,
                duration_seconds: liveEtaSeconds,
                ai_risk_level: 'medium',
                deadline_timestamp: trip.deadline_timestamp,
                current_slack_hours: liveSlackTimeHours
            };

            const decision = await evaluateTripAnomaly(trip, delayMinutes, currentLat, currentLng, currentRouteStats);
                
                if (decision.action === 'reroute' && decision.new_route_id) {
                    console.log(`[Worker] 🔄 AGENT DECISION: Rerouting Trip ${trip.id} to ${decision.new_route_id}`);
                    
                    const cachedRoute = getRouteFromCache(decision.new_route_id);
                    let newRouteDbId = trip.current_route_id; // Default fallback

                    if (cachedRoute) {
                        console.log(`[Worker] Saving Agent Ad-Hoc Route to Database...`);
                        
                        // Find the next route_index letter for this trip (A, B, C...)
                        const idxRes = await pool.query(
                            'SELECT COUNT(*) AS route_count FROM routes WHERE trip_id = $1',
                            [trip.id]
                        );
                        const nextIndex = String.fromCharCode(65 + parseInt(idxRes.rows[0].route_count));

                        // Calculate estimated cost and risk for the UI
                        const truckMileage = parseFloat(trip.mileage_kmpl) || 4.0;
                        const fuelCost = (cachedRoute.distance / 1000 / truckMileage) * 90; // Fuel @ 90
                        const totalCost = fuelCost + (cachedRoute.toll_cost || 0);

                        // Insert the new route
                        const insertRes = await pool.query(`
                            INSERT INTO routes 
                            (trip_id, route_index, polyline, distance_meters, duration_seconds, has_tolls, toll_cost, is_ai_recommended, ai_total_cost_inr, ai_risk_level)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, 'low')
                            RETURNING id
                        `, [
                            trip.id, 
                            nextIndex, 
                            cachedRoute.polyline, 
                            cachedRoute.distance, 
                            cachedRoute.duration, 
                            cachedRoute.has_tolls || false,
                            cachedRoute.toll_cost || 0,
                            totalCost
                        ]);
                        
                        newRouteDbId = insertRes.rows[0].id;
                        console.log(`[Worker] Saved new route as ID: ${newRouteDbId} (Index ${nextIndex})`);
                    } else {
                        console.warn(`[Worker] Route ${decision.new_route_id} not found in cache. Cannot save geometry!`);
                    }

                    // Update the trip with the new reasoning, decision, and the new route
                    // We immediately set live_eta_seconds to the new route's duration so the frontend updates instantly.
                    await pool.query(`
                        UPDATE trips 
                        SET ai_reroute_reason = $1, 
                            current_route_id = $2, 
                            ai_decision = $3, 
                            live_eta_seconds = $4
                        WHERE id = $5
                    `, [decision.reasoning, newRouteDbId, decision.action, cachedRoute.duration, trip.id]);
                } else {
                    console.log(`[Worker] 🛣️ AGENT DECISION: Stay the course.`);
                    await pool.query(`
                        UPDATE trips SET ai_reroute_reason = $1, ai_decision = 'stay_course' WHERE id = $2
                    `, [decision.reasoning || 'AI evaluated alternative routes but decided staying the course is optimal.', trip.id]);
                }
            }

    } catch (err) {
        console.error(`[Worker] Failed to process trip ${trip.id}:`, err);
    }
}
