import dotenv from 'dotenv';
dotenv.config();

// Verified URL from Google Routes API v2 documentation
// POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
const ROUTES_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

// Limit imposed by the API when using TRAFFIC_AWARE: origins × destinations ≤ 625
// For TRAFFIC_AWARE_OPTIMAL: origins × destinations ≤ 100
// Since we use strict 1-to-1 pairs (N×1 each), a single batch of up to 100 segments is safe.
const MAX_BATCH_SIZE = 25;

/**
 * Fetch with-traffic durations for a list of strict 1-to-1 segment pairs
 * using the Google Routes Matrix API v2.
 *
 * segment[i].start → segment[i].end (no cross-pairing)
 *
 * Returns an array of duration_in_traffic_seconds (integers), same length as input.
 * Indices where data is unavailable remain null.
 *
 * @param {Array<{start_lat: number, start_lng: number, end_lat: number, end_lng: number}>} segments
 * @returns {Promise<Array<number|null>>}
 */
export async function fetchSegmentTrafficDurations(segments) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY is not defined in environment variables.');
    }

    if (!segments || segments.length === 0) {
        return [];
    }

    // Pre-fill results with nulls
    const durations = new Array(segments.length).fill(null);

    // Process in batches to respect API limits
    for (let batchStart = 0; batchStart < segments.length; batchStart += MAX_BATCH_SIZE) {
        const batchSegments = segments.slice(batchStart, batchStart + MAX_BATCH_SIZE);

        // Build strict 1-to-1 pairs: each origin[i] only matches destination[i]
        // The Matrix API returns an N×M matrix; we send N origins and N destinations
        // then only read diagonal entries where originIndex === destinationIndex
        const origins = batchSegments.map((seg) => ({
            waypoint: {
                location: {
                    latLng: {
                        latitude: seg.start_lat,
                        longitude: seg.start_lng,
                    },
                },
            },
        }));

        const destinations = batchSegments.map((seg) => ({
            waypoint: {
                location: {
                    latLng: {
                        latitude: seg.end_lat,
                        longitude: seg.end_lng,
                    },
                },
            },
        }));

        const requestBody = {
            origins,
            destinations,
            travelMode: 'DRIVE',
            // TRAFFIC_AWARE gives us real-time duration in the `duration` field
            // without the 100-pair limit of TRAFFIC_AWARE_OPTIMAL
            routingPreference: 'TRAFFIC_AWARE',
        };

        let response;
        try {
            response = await fetch(ROUTES_MATRIX_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    // Must include `status` — without it all entries appear OK even on failure
                    'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,status,condition',
                },
                body: JSON.stringify(requestBody),
            });
        } catch (networkErr) {
            console.error('Routes Matrix API network error:', networkErr.message);
            // Leave this batch as nulls, continue with next batch
            continue;
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            const message = errData?.error?.message || `Routes Matrix API returned status ${response.status}`;
            console.error('Routes Matrix API error:', message, errData);
            // Leave this batch as nulls, continue with next batch
            continue;
        }

        // The API returns an array (streamed) of route matrix elements
        let matrixEntries;
        try {
            matrixEntries = await response.json();
        } catch (parseErr) {
            console.error('Failed to parse Routes Matrix API response:', parseErr.message);
            continue;
        }

        if (!Array.isArray(matrixEntries)) {
            console.warn('Routes Matrix API response was not an array:', matrixEntries);
            continue;
        }

        for (const entry of matrixEntries) {
            const originIdx = entry.originIndex;
            const destIdx = entry.destinationIndex;

            // Strict 1-to-1: only read diagonal entries
            if (originIdx !== destIdx) {
                continue;
            }

            // Skip entries with non-zero status codes (errors)
            if (entry.status?.code && entry.status.code !== 0) {
                console.warn(`Segment ${batchStart + originIdx} failed:`, entry.status);
                continue;
            }

            // `duration` is a string like "142s" or "3.5s" when traffic is included
            if (typeof entry.duration === 'string' && entry.duration.endsWith('s')) {
                const parsedSeconds = parseFloat(entry.duration.replace('s', ''));
                if (Number.isFinite(parsedSeconds)) {
                    durations[batchStart + originIdx] = Math.round(parsedSeconds);
                }
            } else if (typeof entry.duration === 'number') {
                durations[batchStart + originIdx] = Math.round(entry.duration);
            }
        }
    }

    return durations;
}
