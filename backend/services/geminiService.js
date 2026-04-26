import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Build the structured prompt for Gemini.
 * @param {Array} routes - Array of route objects with computed metrics
 * @returns {string} The full prompt string
 */
function buildPrompt(routes) {
    const routeJson = JSON.stringify(routes, null, 2);

    return `You are an expert logistics route decision engine for commercial heavy freight operations.

Your task is to analyze the candidate routes below and select the single BEST route for a truck delivery.

---
ROUTES DATA:
${routeJson}
---

FIELD DEFINITIONS:
- id: Route identifier (A, B, C, etc.)
- eta_hours: Estimated hours to reach destination (lower is better)
- fuel_cost_inr: Fuel cost in Indian Rupees (lower is better)
- toll_cost_inr: Toll cost in INR; null means "not available" (treat conservatively as potentially high)
- reliability_score: Composite risk score (0.0 = perfect, 1.3+ = extreme risk). Lower is ALWAYS better.
  - 0.0–0.3: Stable
  - 0.3–0.7: Risky
  - 0.7+: Unstable
- slack_time_hours: Buffer time before delivery deadline (higher is better). Negative = already late.

DECISION RULES (apply in priority order):
1. SAFETY FIRST: Never select a route with reliability_score > 1.0 if a safer alternative exists.
2. DEADLINE ADHERENCE: Strongly prefer routes with slack_time_hours > 0.25. Negative slack is a critical flag.
3. COST EFFICIENCY: Among equally safe routes, prefer lower total cost (fuel + toll). If toll_cost_inr is null, treat it conservatively (assume it may add cost).
4. SPEED: Use ETA as a tiebreaker only — do not sacrifice more than 0.3 reliability points for a 1-hour ETA gain.

RESPONSE FORMAT — Respond ONLY with valid JSON, no markdown, no explanation outside the JSON:

{
  "selected_route": "<route_id>",
  "reasoning": [
    "<specific reason 1 referencing actual numbers>",
    "<specific reason 2 referencing actual numbers>",
    "<specific reason 3 referencing actual numbers>"
  ],
  "summary": {
    "eta_hours": <number>,
    "total_cost_inr": <number or null>,
    "slack_time_hours": <number>,
    "risk_level": "low | medium | high"
  }
}`;
}

/**
 * Ask Gemini Flash to pick the best route for a trip.
 *
 * @param {Array<{
 *   id: string,
 *   eta_hours: number,
 *   fuel_cost_inr: number,
 *   toll_cost_inr: number|null,
 *   reliability_score: number|null,
 *   slack_time_hours: number|null
 * }>} routes - Lightweight per-route metrics
 *
 * @returns {Promise<{
 *   selected_route: string,
 *   reasoning: string[],
 *   summary: { eta_hours: number, total_cost_inr: number|null, slack_time_hours: number, risk_level: string }
 * }>}
 */
export async function getAIRouteRecommendation(routes) {
    if (!routes || routes.length === 0) {
        throw new Error('[Gemini] No routes provided for recommendation.');
    }

    if (routes.length === 1) {
        console.log('[Gemini] Only one route — skipping AI call, returning it directly.');
        return {
            selected_route: routes[0].id,
            reasoning: ['Only one route available.'],
            summary: {
                eta_hours: routes[0].eta_hours,
                total_cost_inr: (routes[0].fuel_cost_inr ?? 0) + (routes[0].toll_cost_inr ?? 0),
                slack_time_hours: routes[0].slack_time_hours,
                risk_level: routes[0].reliability_score < 0.3 ? 'low' : routes[0].reliability_score < 0.7 ? 'medium' : 'high'
            }
        };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('[Gemini] GEMINI_API_KEY is not set in environment variables.');
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = buildPrompt(routes);

    console.log(`[Gemini] Sending ${routes.length} routes for analysis...`);

    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();

    console.log('[Gemini] Raw response received.');

    // Strip markdown code fences if Gemini wraps the JSON
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
        console.log('[Gemini] FULL RESPONSE:', JSON.stringify(parsed, null, 2));
    } catch (err) {
        console.error('[Gemini] Failed to parse response:', rawText);
        throw new Error(`[Gemini] Invalid JSON response: ${err.message}`);
    }

    if (!parsed.selected_route) {
        throw new Error('[Gemini] Response is missing "selected_route" field.');
    }

    console.log(`[Gemini] Selected route: ${parsed.selected_route} | Risk: ${parsed.summary?.risk_level}`);
    return parsed;
}
