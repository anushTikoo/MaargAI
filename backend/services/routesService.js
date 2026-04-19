import dotenv from 'dotenv';
dotenv.config();

/**
 * Service to interact with the Google Routes API (v2)
 */
export async function getRoutes(sourceLat, sourceLng, destLat, destLng) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
        throw new Error("GOOGLE_MAPS_API_KEY is not defined in environment variables.");
    }

    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    // Task 7: Request Configuration
    const requestBody = {
        origin: {
            location: {
                latLng: {
                    latitude: sourceLat,
                    longitude: sourceLng
                }
            }
        },
        destination: {
            location: {
                latLng: {
                    latitude: destLat,
                    longitude: destLng
                }
            }
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
        computeAlternativeRoutes: true // Important: fetching alternative routes
    };

    try {
        // Task 6: Call Google Routes API
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                // Add Referer to satisfy API key restrictions
                'Referer': process.env.CLIENT_URL || 'http://localhost:3000',
                // FieldMask allows us to limit response size and specify extraction targets exactly
                'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.routeLabels'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error("Google Routes API Error details:", errData);
            throw new Error(`Google Routes API failed with status ${response.status}`);
        }

        const data = await response.json();

        // Task 8: Parse API Response
        if (!data.routes || data.routes.length === 0) {
            return []; // No routes found
        }

        const parsedRoutes = data.routes.map(route => {
            // "routeLabels" may contain things like "ROUTE_LABEL_UNSPECIFIED", "DEFAULT_ROUTE", etc.
            // But realistically we are looking if it mentions tolls. Often APIs expose tolls via a different structure (route.travelAdvisory.tollInfo),
            // but we'll extract routeLabels as requested by the architecture task to check for toll tags or default markings.
            const routeLabels = route.routeLabels || [];

            // NOTE: duration comes back as a string like "180s" from Routes API v2
            const durationRaw = route.duration || "0s";
            const durationSeconds = parseInt(durationRaw.replace('s', ''), 10);

            return {
                polyline: route.polyline?.encodedPolyline || "",
                distanceMeters: route.distanceMeters || 0,
                durationSeconds: durationSeconds,
                routeLabels: routeLabels,
                hasTolls: routeLabels.some(label => label.toLowerCase().includes("toll")) // Best effort parsing standard Google labels
            };
        });

        return parsedRoutes;

    } catch (error) {
        console.error("Error communicating with Google Routes API:", error);
        throw error;
    }
}
