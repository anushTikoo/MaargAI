import pool from '../db.js';
import { evaluateTripAnomaly } from './geminiService.js';
import { getRoutes } from './routesService.js';
import { getRouteFromCache } from './agentTools.js';
import { decodePolyline, encodePolyline, segmentRoute, getDistanceToPolyline, calculateDistanceMeters } from './segmentationService.js';
import { fetchSegmentTrafficDurations } from './trafficService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Dynamic delay thresholds (minutes) based on available slack. */
const DELAY_THRESHOLD_TIGHT_SLACK = 10;  // slack < 0.5h
const DELAY_THRESHOLD_NORMAL_SLACK = 15;  // slack >= 0.5h or unknown
const DELAY_THRESHOLD_NO_DEADLINE = 20;  // no deadline set

/** Trigger 2: minimum absolute reliability score AND minimum delta to fire. */
const RELIABILITY_SPIKE_ABSOLUTE_MIN = 0.7;  // route must be "Risky+"
const RELIABILITY_SPIKE_DELTA_MIN = 0.3;  // must have worsened by this much since last check

/** Trigger 3: minimum gap (minutes) since last AI call for an opportunity scan. */
const OPPORTUNITY_CHECK_INTERVAL_MIN = 30;

// ─── Main Loop ───────────────────────────────────────────────────────────────

/**
 * Main monitoring loop. Fetches all active trips and processes each one.
 */
export async function processActiveTrips() {
    console.log('[Worker] Starting monitoring loop...');
    const startTime = Date.now();

    try {
        const { rows: trips } = await pool.query(`
            SELECT t.*, tr.mileage_kmpl,
                   r.polyline, r.route_index AS current_route_index,
                   r.distance_meters AS route_distance, r.duration_seconds AS route_duration
            FROM trips t
            JOIN trucks tr ON t.truck_id = tr.id
            LEFT JOIN routes r ON t.current_route_id = r.id
            WHERE t.status = 'active'
              AND t.current_route_id IS NOT NULL
              AND t.ai_decision IS NOT NULL
        `);

        console.log(`[Worker] Found ${trips.length} active trip(s) to process.`);

        for (const trip of trips) {
            await processSingleTrip(trip);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Worker] Loop completed in ${duration}s.`);
        return { processed: trips.length, duration };

    } catch (err) {
        console.error('[Worker] Error in monitoring loop:', err);
        throw err;
    }
}

// ─── Single Trip Processor ───────────────────────────────────────────────────

async function processSingleTrip(trip) {
    // Skip trips with no recorded GPS (truck hasn't moved yet).
    if (!trip.last_gps_lat) return;

    const currentLat = parseFloat(trip.last_gps_lat);
    const currentLng = parseFloat(trip.last_gps_lng);

    try {
        // ── Step 1: Get live ETA specifically for the ASSIGNED route ──────────
        const pathAnalysis = getDistanceToPolyline(currentLat, currentLng, trip.polyline);
        const isDeviated = !pathAnalysis.isNear;

        let liveEtaSeconds = trip.route_duration; // Baseline fallback
        let liveDistanceMeters = trip.route_distance;

        if (!isDeviated && trip.polyline) {
            try {
                const points = decodePolyline(trip.polyline);
                const remainingPoints = points.slice(pathAnalysis.nearestIndex);
                
                // Calculate remaining distance purely from polyline
                liveDistanceMeters = remainingPoints.reduce((sum, p, i) => 
                    i === 0 ? 0 : sum + calculateDistanceMeters(remainingPoints[i-1], remainingPoints[i]), 0);

                // For a highly accurate ETA on the SAME route, we segment the remaining path 
                // and fetch current traffic for those specific segments.
                const remainingSegments = segmentRoute(remainingPoints, 12); // ~12km segments
                if (remainingSegments.length > 0) {
                    const trafficDurations = await fetchSegmentTrafficDurations(remainingSegments);
                    const validDurations = trafficDurations.filter(d => d !== null);
                    
                    if (validDurations.length > 0) {
                        // We use the traffic data for the segments we could fetch, 
                        // and estimate the rest (if any) using the ratio.
                        const sumTraffic = validDurations.reduce((a, b) => a + b, 0);
                        const coverageRatio = validDurations.length / remainingSegments.length;
                        liveEtaSeconds = Math.round(sumTraffic / coverageRatio);
                        
                        console.log(`[Worker] Trip ${trip.id}: Live ETA updated using ${validDurations.length}/${remainingSegments.length} segments of assigned route.`);
                    }
                }
            } catch (err) {
                console.warn(`[Worker] Failed to compute route-specific ETA for trip ${trip.id}:`, err.message);
                // Fallback: use a basic distance-based estimate or the fastest Google route
                const routes = await getRoutes(currentLat, currentLng, trip.dest_lat, trip.dest_lng);
                if (routes.length > 0) {
                    liveEtaSeconds = routes[0].durationSeconds;
                    liveDistanceMeters = routes[0].distanceMeters;
                }
            }
        } else {
            // If deviated, we HAVE to ask Google for a new route to the destination
            const routes = await getRoutes(currentLat, currentLng, trip.dest_lat, trip.dest_lng);
            if (routes.length > 0) {
                liveEtaSeconds = routes[0].durationSeconds;
                liveDistanceMeters = routes[0].distanceMeters;
            }
        }

        // ── Step 2: Calculate delay & slack ──────────────────────────────────
        // Delay = current Google ETA − how much time was still budgeted at this moment.
        // expectedRemaining decreases as real time passes; if liveEta stays high despite
        // time passing, the truck is genuinely behind schedule.
        const createdAtMs = new Date(trip.created_at).getTime();
        const secondsElapsed = Math.floor((Date.now() - createdAtMs) / 1000);
        const expectedRemainingSeconds = Math.max(0, (trip.baseline_eta_seconds || 0) - secondsElapsed);
        
        // We use the live ETA of the ASSIGNED route to measure delay
        const totalDelaySeconds = Math.max(0, liveEtaSeconds - expectedRemainingSeconds);
        const delayMinutes = Math.floor(totalDelaySeconds / 60);

        const predictedArrivalMs = Date.now() + (liveEtaSeconds * 1000);
        let liveSlackTimeHours = null;
        if (trip.deadline_timestamp) {
            const deadlineMs = new Date(trip.deadline_timestamp).getTime();
            const slackMs = deadlineMs - predictedArrivalMs;
            liveSlackTimeHours = parseFloat((slackMs / 3600000).toFixed(2));
        }

        console.log(`[Worker] Trip ${trip.id} | Elapsed: ${Math.floor(secondsElapsed / 60)}m | Expected Remaining: ${Math.floor(expectedRemainingSeconds / 60)}m | Live ETA (Google): ${Math.floor(liveEtaSeconds / 60)}m | Delay: ${delayMinutes}m | Slack: ${liveSlackTimeHours ?? 'N/A'}h`);

        // ── Step 3: Persist checkpoint & live metrics ─────────────────────────
        const riskMap = { low: 0.1, medium: 0.4, high: 0.8 };
        const numericalRisk = riskMap[trip.ai_risk_level] || 0.0;

        await pool.query(`
            INSERT INTO trip_checkpoints (trip_id, lat, lng, current_delay_seconds, estimated_remaining_seconds, risk_score)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [trip.id, currentLat, currentLng, totalDelaySeconds, liveEtaSeconds, numericalRisk]);

        await pool.query(`
            UPDATE trips
            SET last_checked_at       = CURRENT_TIMESTAMP,
                live_eta_seconds      = $1,
                live_distance_meters  = $2,
                live_slack_time_hours = $3
            WHERE id = $4
        `, [liveEtaSeconds, liveDistanceMeters, liveSlackTimeHours, trip.id]);

        // ── Step 4: PROACTIVE TRIGGER ENGINE ─────────────────────────────────

        const triggerResult = await evaluateTriggers(
            trip, delayMinutes, liveSlackTimeHours, liveEtaSeconds, liveDistanceMeters, currentLat, currentLng, isDeviated
        );

        if (triggerResult.shouldCallAI) {
            await runAIEvaluation(trip, delayMinutes, currentLat, currentLng, liveEtaSeconds, liveDistanceMeters, liveSlackTimeHours, triggerResult.reason);
        }

        // Persist the freshly computed reliability score (so next run can detect delta).
        if (triggerResult.currentReliability !== null) {
            await pool.query(
                'UPDATE trips SET last_route_reliability = $1 WHERE id = $2',
                [triggerResult.currentReliability, trip.id]
            );
        }

    } catch (err) {
        console.error(`[Worker] Error processing trip ${trip.id}:`, err.message);
    }
}

// ─── Trigger Engine ───────────────────────────────────────────────────────────

/**
 * Evaluates all three trigger conditions in priority order.
 * Returns { shouldCallAI, reason, currentReliability }.
 *
 * Gemini is called at most once per trip per worker cycle.
 * No weather API is called here — weather is handled inside the Gemini Agent's
 * analyze_route_segments tool during the deep investigation.
 */
async function evaluateTriggers(trip, delayMinutes, liveSlackTimeHours, liveEtaSeconds, liveDistanceMeters, currentLat, currentLng, isDeviated) {
    // ── Trigger 1: Significant delay (dynamic threshold based on slack) ───────
    const delayThreshold = computeDelayThreshold(liveSlackTimeHours, trip.deadline_timestamp);

    if (delayMinutes > delayThreshold) {
        console.log(`[Worker] 🚨 TRIGGER 1 (Delay) fired for Trip ${trip.id}: ${delayMinutes}m > ${delayThreshold}m threshold.`);
        return { shouldCallAI: true, reason: 'delay', currentReliability: null };
    }

    // ── Trigger 2: Reliability spike (lightweight traffic-only check) ─────────
    let currentReliability = null;
    try {
        currentReliability = await computeLightweightReliability(trip.polyline, liveDistanceMeters);

        if (currentReliability !== null) {
            const prevReliability = parseFloat(trip.last_route_reliability) || 0;
            const delta = currentReliability - prevReliability;

            console.log(`[Worker] 📊 Trip ${trip.id} Reliability: current=${currentReliability.toFixed(3)}, prev=${prevReliability.toFixed(3)}, delta=${delta.toFixed(3)}`);

            // COLD-START GUARD: skip if no real baseline exists yet (first run = prev is null/0).
            // A delta against 0 is meaningless and causes false spikes.
            const hasPreviousBaseline = trip.last_route_reliability !== null && trip.last_route_reliability !== undefined;

            if (hasPreviousBaseline && currentReliability >= RELIABILITY_SPIKE_ABSOLUTE_MIN && delta >= RELIABILITY_SPIKE_DELTA_MIN) {
                console.log(`[Worker] 🚦 TRIGGER 2 (Risk Spike) fired for Trip ${trip.id}.`);
                return { shouldCallAI: true, reason: 'risk_spike', currentReliability };
            }
        }
    } catch (err) {
        // Non-fatal: if lightweight check fails, skip Trigger 2, don't abort the loop.
        console.warn(`[Worker] Lightweight reliability check failed for trip ${trip.id}: ${err.message}`);
    }

    // ── Trigger 3: Deviation ────────────────────────────────────────────────
    if (isDeviated) {
        console.log(`[Worker] ⚠️  TRIGGER 3 (Deviation) fired for Trip ${trip.id}: Truck is >500m off the assigned route.`);
        return { shouldCallAI: true, reason: 'deviation', currentReliability };
    }

    // ── Trigger 4: Periodic opportunity scan ─────────────────────────────────
    // When last_ai_trigger_at is null (AI never called), fall back to created_at.
    // This prevents Trigger 3 from firing immediately on brand-new trips.
    const lastAICallAt = trip.last_ai_trigger_at
        ? new Date(trip.last_ai_trigger_at)
        : new Date(trip.created_at);
    const minutesSinceLastAI = (Date.now() - lastAICallAt.getTime()) / 60000;

    if (minutesSinceLastAI > OPPORTUNITY_CHECK_INTERVAL_MIN) {
        console.log(`[Worker] 🔭 TRIGGER 4 (Opportunity) fired for Trip ${trip.id}: ${Math.floor(minutesSinceLastAI)}m since last AI call.`);
        return { shouldCallAI: true, reason: 'opportunity', currentReliability };
    }

    console.log(`[Worker] ✅ Trip ${trip.id}: All clear. No triggers fired.`);
    return { shouldCallAI: false, reason: null, currentReliability };
}

/**
 * Computes the dynamic delay threshold in minutes based on available slack.
 */
function computeDelayThreshold(liveSlackTimeHours, deadlineTimestamp) {
    if (!deadlineTimestamp) return DELAY_THRESHOLD_NO_DEADLINE;
    if (liveSlackTimeHours !== null && liveSlackTimeHours < 0.5) return DELAY_THRESHOLD_TIGHT_SLACK;
    return DELAY_THRESHOLD_NORMAL_SLACK;
}

/**
 * Lightweight reliability check using traffic data for up to 3 sampled segments.
 * Does NOT call weather API (too slow for a per-cycle check).
 *
 * Returns a reliability score (0.0 – 1.5+) or null if not computable.
 */
async function computeLightweightReliability(polyline, distanceMeters) {
    if (!polyline || !distanceMeters) return null;

    const points = decodePolyline(polyline);
    if (points.length < 2) return null;

    // Dynamic segment size (same formula as in agentTools)
    const totalDistKm = distanceMeters / 1000;
    const segmentSizeKm = Math.max(8, Math.min(20, totalDistKm * 0.1));
    const allSegments = segmentRoute(points, segmentSizeKm);

    if (allSegments.length === 0) return null;

    // Sample up to 3 evenly-spaced segments for a fast check
    const maxSamples = 3;
    const step = Math.max(1, Math.ceil(allSegments.length / maxSamples));
    const sample = [];
    for (let i = 0; i < allSegments.length && sample.length < maxSamples; i += step) {
        sample.push(allSegments[i]);
    }

    const trafficDurations = await fetchSegmentTrafficDurations(sample);

    const avgSegmentTime = allSegments.reduce((sum, s) => sum + (s.distance / 1000) * 60, 0) / allSegments.length;
    if (avgSegmentTime === 0) return null;

    const validDurations = trafficDurations.filter(d => d !== null);
    if (validDurations.length === 0) return null;

    // Weighted reliability (traffic only — matches 40% avg + 30% max from the full formula)
    const avgDelayRatio = validDurations.reduce((a, b) => a + b, 0) / (validDurations.length * avgSegmentTime);
    const maxDelayRatio = Math.max(...validDurations.map(d => d / avgSegmentTime));

    // Scaled to a 0–1.0 score (traffic-only components of the full formula)
    const reliability = (Math.min(avgDelayRatio - 1, 1.0) * 0.4) + (Math.min(maxDelayRatio - 1, 1.5) * 0.3);
    return parseFloat(Math.max(0, reliability).toFixed(3));
}

// ─── AI Evaluation ───────────────────────────────────────────────────────────

/**
 * Calls the Gemini ReAct Agent and persists its decision.
 */
async function runAIEvaluation(trip, delayMinutes, currentLat, currentLng, liveEtaSeconds, liveDistanceMeters, liveSlackTimeHours, triggerReason) {
    // CONCURRENT-CYCLE GUARD: re-read last_ai_trigger_at from DB.
    // A Gemini call can take 60-70s. If another worker cycle started while the first was
    // still running, both would try to call AI. We skip if AI was already triggered in the
    // last 2 minutes (well within a single worker interval).
    const freshCheck = await pool.query('SELECT last_ai_trigger_at FROM trips WHERE id = $1', [trip.id]);
    const freshLastTrigger = freshCheck.rows[0]?.last_ai_trigger_at;
    if (freshLastTrigger) {
        const minutesSince = (Date.now() - new Date(freshLastTrigger).getTime()) / 60000;
        if (minutesSince < 2) {
            console.log(`[Worker] ⏭️  Skipping AI call for Trip ${trip.id} — another cycle already triggered ${minutesSince.toFixed(1)}m ago.`);
            return;
        }
    }

    console.log(`[Worker] 🤖 Invoking Gemini Agent for Trip ${trip.id} (reason: ${triggerReason})...`);

    const currentRouteStats = {
        distance_meters: liveDistanceMeters,
        duration_seconds: liveEtaSeconds,
        ai_risk_level: 'medium',
        deadline_timestamp: trip.deadline_timestamp,
        current_slack_hours: liveSlackTimeHours,
        trigger_reason: triggerReason,
        polyline: trip.polyline
    };

    const decision = await evaluateTripAnomaly(trip, delayMinutes, currentLat, currentLng, currentRouteStats);

    // Record that Gemini was just called and the opportunity check timestamp
    await pool.query(`
        UPDATE trips
        SET last_ai_trigger_at          = CURRENT_TIMESTAMP,
            ai_trigger_reason           = $1,
            last_opportunity_check_at   = CURRENT_TIMESTAMP
        WHERE id = $2
    `, [triggerReason, trip.id]);

    // Build fresh reasoning string
    const freshReasoning = Array.isArray(decision.reasoning)
        ? decision.reasoning.join(' ')
        : (decision.reasoning || '');

    if (decision.action === 'reroute' && decision.new_route_id) {
        await handleReroute(trip, decision, freshReasoning, currentLat, currentLng);
    } else {
        console.log(`[Worker] 🛣️  AGENT DECISION: Stay the course for Trip ${trip.id}.`);
        await pool.query(`
            UPDATE trips
            SET ai_reroute_reason = $1, ai_decision = 'stay_course'
            WHERE id = $2
        `, [freshReasoning || 'AI evaluated alternatives but staying on current route is optimal.', trip.id]);
    }
}

// ─── Reroute Handler ─────────────────────────────────────────────────────────

async function handleReroute(trip, decision, freshReasoning, currentLat, currentLng) {
    console.log(`[Worker] 🔄 AGENT DECISION: Reroute Trip ${trip.id} → ${decision.new_route_id}`);

    const cachedRoute = getRouteFromCache(decision.new_route_id);
    let newRouteDbId = trip.current_route_id; // Fallback: keep existing

    if (!cachedRoute) {
        console.warn(`[Worker] Route "${decision.new_route_id}" not found in cache. Cannot save geometry.`);
        return;
    }

    // Check if this exact geometry is already saved (prevents duplicate route bloat)
    const existingRes = await pool.query(
        'SELECT id, route_index FROM routes WHERE trip_id = $1 AND polyline = $2 LIMIT 1',
        [trip.id, cachedRoute.polyline]
    );

    if (existingRes.rowCount > 0) {
        newRouteDbId = existingRes.rows[0].id;
        console.log(`[Worker] Route already exists (ID: ${newRouteDbId}, Index: ${existingRes.rows[0].route_index}). Reusing.`);
        // Mark it as AI-recommended so the locations endpoint returns the correct URL.
        await pool.query('UPDATE routes SET is_ai_recommended = TRUE WHERE id = $1', [newRouteDbId]);
    } else {
        // Determine next route letter (A, B, C...)
        const countRes = await pool.query('SELECT COUNT(*) AS cnt FROM routes WHERE trip_id = $1', [trip.id]);
        const nextIndex = String.fromCharCode(65 + parseInt(countRes.rows[0].cnt));

        // Calculate costs
        const truckMileage = parseFloat(trip.mileage_kmpl) || 4.0;
        const fuelCost = (cachedRoute.distance / 1000 / truckMileage) * 90;
        const totalCost = fuelCost + (cachedRoute.toll_cost || 0);

        // Stitch old history (origin → current position) with new future path
        let finalPolyline = cachedRoute.polyline;
        if (trip.polyline) {
            const oldPoints = decodePolyline(trip.polyline);
            const newPoints = decodePolyline(cachedRoute.polyline);

            let nearestIndex = 0;
            let minDist = Infinity;
            for (let i = 0; i < oldPoints.length; i++) {
                const d = Math.sqrt(
                    Math.pow(oldPoints[i].lat - currentLat, 2) +
                    Math.pow(oldPoints[i].lng - currentLng, 2)
                );
                if (d < minDist) { minDist = d; nearestIndex = i; }
            }

            const stitched = [...oldPoints.slice(0, nearestIndex), ...newPoints];
            finalPolyline = encodePolyline(stitched);
            console.log(`[Worker] Stitched polyline (${nearestIndex} history pts + ${newPoints.length} new pts).`);
        }

        const insertRes = await pool.query(`
            INSERT INTO routes
                (trip_id, route_index, polyline, distance_meters, duration_seconds,
                 has_tolls, toll_cost, is_ai_recommended, ai_total_cost_inr, ai_fuel_cost_inr, ai_risk_level)
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, 'low')
            RETURNING id
        `, [
            trip.id, nextIndex, finalPolyline,
            cachedRoute.distance, cachedRoute.duration,
            cachedRoute.has_tolls || false, cachedRoute.toll_cost || 0,
            totalCost, fuelCost
        ]);

        newRouteDbId = insertRes.rows[0].id;
        console.log(`[Worker] New route saved (ID: ${newRouteDbId}, Index: ${nextIndex}).`);
    }

    // Update the trip record
    await pool.query(`
        UPDATE trips
        SET ai_reroute_reason = $1,
            current_route_id  = $2,
            ai_decision       = 'reroute',
            live_eta_seconds  = $3
        WHERE id = $4
    `, [freshReasoning, newRouteDbId, cachedRoute.duration, trip.id]);
}
