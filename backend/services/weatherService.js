import dotenv from 'dotenv';
dotenv.config();

const OPENWEATHER_BASE = 'https://api.openweathermap.org/data/2.5/weather';

/**
 * Fetch raw weather for a single lat/lon point.
 * Returns only the fields we care about.
 */
export async function getWeather(lat, lon) {
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `${OPENWEATHER_BASE}?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

        const response = await fetch(url, { method: 'GET' });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OpenWeather API Error (${response.status}):`, errorText);
            throw new Error(`OpenWeather API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        return {
            main: data.weather?.[0]?.main || '',
            description: data.weather?.[0]?.description || '',
            visibility: data.visibility ?? null,
            rain_1h: data.rain?.['1h'] ?? null,
            wind_speed: data.wind?.speed ?? null,
        };
    } catch (error) {
        console.error('Error fetching weather data:', error.message);
        throw error;
    }
}

/**
 * Convert raw weather fields into a normalized risk score (0.0 – 1.3).
 *
 * Base score by condition:
 *   Clear / Clouds / Atmosphere        → 0.0
 *   Drizzle / Light Rain (rain_1h < 2) → 0.3
 *   Moderate Rain (rain_1h 2–10)       → 0.5
 *   Heavy Rain (rain_1h ≥ 10)          → 0.7
 *   Snow                               → 0.6
 *   Thunderstorm                       → 1.0
 *
 * Additive penalties:
 *   visibility < 500m                  → +0.3
 *   wind_speed > 15 m/s (~54 km/h)    → +0.2  (high-profile truck tip risk)
 *
 * Capped at 1.3 (theoretical max).
 *
 * @param {string} main       - weather.main from OpenWeather
 * @param {number|null} rain1h - rain.1h in mm (optional)
 * @param {number|null} visibility - visibility in meters
 * @param {number|null} windSpeed  - wind.speed in m/s
 * @returns {number} score 0.0 – 1.3
 */
export function computeWeatherScore(main, rain1h, visibility, windSpeed) {
    const condition = (main || '').toLowerCase();
    let score = 0.0;

    if (condition === 'thunderstorm') {
        score = 1.0;
    } else if (condition === 'snow') {
        score = 0.6;
    } else if (condition === 'rain' || condition === 'drizzle') {
        const mm = rain1h ?? 0;
        if (mm >= 10) {
            score = 0.7;   // heavy rain
        } else if (mm >= 2) {
            score = 0.5;   // moderate rain
        } else {
            score = 0.3;   // light rain / drizzle
        }
    } else {
        // Clear, Clouds, Atmosphere (mist/haze/fog handled below via visibility), etc.
        score = 0.0;
    }

    // Additive penalty: near-zero visibility (fog, heavy smoke, sandstorm)
    if (typeof visibility === 'number' && visibility < 500) {
        score += 0.3;
    }

    // Additive penalty: high crosswind risk for trucks (trailers especially)
    if (typeof windSpeed === 'number' && windSpeed > 15) {
        score += 0.2;
    }

    return parseFloat(Math.min(score, 1.3).toFixed(3));
}

/**
 * Fetch weather scores for every segment using the midpoint of each segment.
 * Each API call is sequential with a small delay to respect free-tier rate limits
 * (60 calls/minute → one call every ~1s is safe).
 *
 * Returns an array of objects { score, weather_main } same length as input segments.
 * Null is returned for any segment where the API call fails.
 *
/**
 * Fetch weather scores for every segment using the midpoint of each segment.
 *
 * @param {Array<{start_lat, start_lng, end_lat, end_lng}>} segments
 * @returns {Promise<Array<{score: number, weather_main: string} | null>>}
 */
export async function fetchSegmentWeatherScores(segments) {
    if (!segments || segments.length === 0) return [];

    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
        console.warn('[Weather] OPENWEATHER_API_KEY is not set — skipping weather enrichment.');
        return new Array(segments.length).fill(null);
    }

    console.log(`[Weather] Enriching route with ${segments.length} segment(s)...`);

    // For demo/performance: Sample a max of 6 segments across the route
    const maxSamples = 6;
    const step = Math.max(1, Math.ceil(segments.length / maxSamples));
    const sampleIndices = [];
    for (let i = 0; i < segments.length; i += step) {
        sampleIndices.push(i);
    }
    // Always include the last segment if not already included
    if (sampleIndices[sampleIndices.length - 1] !== segments.length - 1) {
        sampleIndices.push(segments.length - 1);
    }

    const results = new Array(segments.length).fill(null);

    for (const i of sampleIndices) {
        const seg = segments[i];
        const midLat = (seg.start_lat + seg.end_lat) / 2;
        const midLng = (seg.start_lng + seg.end_lng) / 2;

        try {
            const url = `${OPENWEATHER_BASE}?lat=${midLat}&lon=${midLng}&appid=${apiKey}&units=metric`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[Weather] Segment ${i}: HTTP ${response.status}`);
                continue;
            }

            const data = await response.json();
            const main = data.weather?.[0]?.main || '';
            const rain1h = data.rain?.['1h'] ?? null;
            const visibility = data.visibility ?? null;
            const windSpeed = data.wind?.speed ?? null;

            const score = computeWeatherScore(main, rain1h, visibility, windSpeed);
            console.log(`[Weather] Segment ${i} Sample: ${main}, score=${score}`);

            results[i] = { score, weather_main: main };
        } catch (err) {
            console.warn(`[Weather] Segment ${i}: fetch error — ${err.message}`);
        }

        // Delay to respect rate limits
        await new Promise((r) => setTimeout(r, 800));
    }

    // Fill in the gaps: Assign the nearest sample's score to missing segments
    let lastKnown = null;
    for (let i = 0; i < results.length; i++) {
        if (results[i]) {
            lastKnown = results[i];
        } else if (lastKnown) {
            results[i] = { ...lastKnown };
        }
    }

    console.log(`[Weather] Complete: Sampled ${sampleIndices.length} segments.`);
    return results;
}
