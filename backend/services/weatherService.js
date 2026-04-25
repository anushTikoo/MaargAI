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

    console.log(`[Weather] Enriching ${segments.length} segment(s)...`);

    const results = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const midLat = (seg.start_lat + seg.end_lat) / 2;
        const midLng = (seg.start_lng + seg.end_lng) / 2;

        try {
            const url = `${OPENWEATHER_BASE}?lat=${midLat}&lon=${midLng}&appid=${apiKey}&units=metric`;
            const response = await fetch(url);

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                console.warn(`[Weather] Segment ${i}: HTTP ${response.status} — ${body}`);
                results.push(null);
                await new Promise((r) => setTimeout(r, 1050)); // delay even on error
                continue;
            }

            const data = await response.json();
            const main = data.weather?.[0]?.main || '';
            const rain1h = data.rain?.['1h'] ?? null;
            const visibility = data.visibility ?? null;
            const windSpeed = data.wind?.speed ?? null;

            const score = computeWeatherScore(main, rain1h, visibility, windSpeed);
            console.log(`[Weather] Segment ${i}: ${main}, score=${score}`);

            results.push({ score, weather_main: main });
        } catch (err) {
            console.warn(`[Weather] Segment ${i}: fetch error — ${err.message}`);
            results.push(null);
        }

        // Respect OpenWeather free-tier rate limit (~1 req/sec)
        await new Promise((r) => setTimeout(r, 1050));
    }

    console.log(`[Weather] Complete: ${results.filter(Boolean).length}/${segments.length} segments enriched.`);
    return results;
}
