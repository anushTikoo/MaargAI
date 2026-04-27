import { getRoutes } from './routesService.js';
import { decodePolyline, segmentRoute } from './segmentationService.js';
import { fetchSegmentTrafficDurations } from './trafficService.js';
import { fetchSegmentWeatherScores } from './weatherService.js';

// Simple in-memory cache to hold route geometries between Tool calls.
// In a production system with multiple workers, use Redis.
const routeCache = new Map();

export function getRouteFromCache(routeId) {
    return routeCache.get(routeId);
}

/**
 * Tool 1: Fetches alternative routes from the Google Maps API.
 */
export async function get_alternative_routes({ currentLat, currentLng, destLat, destLng, truckMileage, currentRoutePolyline }) {
    console.log(`[Tool] Executing get_alternative_routes for ${currentLat},${currentLng} to ${destLat},${destLng}`);
    
    try {
        const routes = await getRoutes(currentLat, currentLng, destLat, destLng);

        const options = routes.map((r, index) => {
            const id = `Alternative Route ${index + 1}`;
            
            // Check if this alternative is effectively the same as the current route
            // We use a simple length check + polyline match for speed
            const isCurrent = currentRoutePolyline && (r.polyline === currentRoutePolyline);
            
            // Save to cache so the next tool can analyze it
            routeCache.set(id, {
                polyline: r.polyline,
                distance: r.distanceMeters,
                duration: r.durationSeconds
            });

            // Fuel estimation using actual truck mileage
            const mileage = parseFloat(truckMileage) || 4.0;
            const fuelCost = (r.distanceMeters / 1000 / mileage) * 90;
            const tollCost = r.hasTolls ? 450 : 0; // Simulated toll cost if API doesn't provide it

            return {
                route_id: id,
                is_current_route: isCurrent,
                distance_meters: r.distanceMeters,
                duration_seconds: r.durationSeconds,
                has_tolls: r.hasTolls,
                estimated_fuel_cost_inr: Math.round(fuelCost),
                estimated_toll_cost_inr: tollCost,
                estimated_total_cost_inr: Math.round(fuelCost + tollCost)
            };
        });

        return { 
            routes_found: options.length,
            routes: options
        };
    } catch (err) {
        return { error: `Routes API returned error: ${err.message}` };
    }
}

/**
 * Tool 2: Analyzes a specific route by breaking it into segments and getting real-time weather and traffic density.
 */
export async function analyze_route_segments({ route_id }) {
    console.log(`[Tool] Executing analyze_route_segments for ${route_id}`);
    
    const route = routeCache.get(route_id);
    if (!route) {
        return { error: `Route ${route_id} not found in cache. Call get_alternative_routes first.` };
    }

    try {
        const path = decodePolyline(route.polyline);
        if (path.length < 2) return { error: "Route too short to analyze." };

        // Segment the route into chunks (using 5000 meters for fast demo analysis)
        const segments = segmentRoute(path, 5000);
        
        if (segments.length === 0) return { error: "Failed to segment route." };

        // We sample segments (max 6) spread across the route for a representative analysis
        const maxSamples = 6;
        const step = Math.max(1, Math.ceil(segments.length / maxSamples));
        const sampleSegments = [];
        for (let i = 0; i < segments.length; i += step) {
            sampleSegments.push(segments[i]);
            if (sampleSegments.length >= maxSamples) break;
        }

        // Fetch Traffic
        const trafficDurations = await fetchSegmentTrafficDurations(sampleSegments);
        
        // Fetch Weather
        const weatherScores = await fetchSegmentWeatherScores(sampleSegments);

        let congestedSegments = 0;
        let badWeatherSegments = 0;
        let weatherConditions = new Set();

        const avgSegmentTime = route.duration / segments.length;

        for (let i = 0; i < sampleSegments.length; i++) {
            const traffic = trafficDurations[i];
            const weather = weatherScores[i];

            if (traffic !== null && avgSegmentTime > 0) {
                const ratio = traffic / avgSegmentTime;
                if (ratio > 1.5) congestedSegments++;
            }

            if (weather) {
                weatherConditions.add(weather.weather_main);
                if (weather.score > 0.5) badWeatherSegments++; // Updated threshold for 0.0-1.3 scale
            }
        }

        const avgDelay = trafficDurations.length > 0 
            ? trafficDurations.reduce((a, b) => a + (b || avgSegmentTime), 0) / (trafficDurations.length * avgSegmentTime)
            : 1.0;

        const maxDelay = trafficDurations.length > 0
            ? Math.max(...trafficDurations.map(d => (d || avgSegmentTime) / avgSegmentTime))
            : 1.0;

        return {
            route_id,
            analysis: {
                total_segments_analyzed: sampleSegments.length,
                heavy_traffic_segments: congestedSegments,
                bad_weather_segments: badWeatherSegments,
                observed_weather_conditions: Array.from(weatherConditions),
                avg_delay_ratio: parseFloat(avgDelay.toFixed(2)),
                max_delay_ratio: parseFloat(maxDelay.toFixed(2)),
                traffic_density_score: parseFloat((congestedSegments / sampleSegments.length).toFixed(2))
            }
        };

    } catch (err) {
        console.error(`[Tool] Error analyzing route ${route_id}:`, err);
        return { error: "Failed to analyze route due to internal error." };
    }
}
