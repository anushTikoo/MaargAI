import { GoogleGenAI } from '@google/genai';
import { get_alternative_routes, analyze_route_segments } from './agentTools.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Extracts and parses JSON from a potentially messy string.
 * @param {string} text 
 * @returns {Object}
 */
function robustParseJSON(text) {
    if (!text) return {};
    
    // 1. Strip markdown fences
    let clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // 2. The model might have outputted multiple JSON blocks (hallucinated tool responses + final decision)
    // We try to find the last valid JSON object that contains the fields we need.
    const results = [];
    let braceCount = 0;
    let start = -1;

    for (let i = 0; i < clean.length; i++) {
        if (clean[i] === '{') {
            if (braceCount === 0) start = i;
            braceCount++;
        } else if (clean[i] === '}') {
            braceCount--;
            if (braceCount === 0 && start !== -1) {
                const block = clean.substring(start, i + 1);
                try {
                    results.push(JSON.parse(block));
                } catch (e) {
                    // Ignore invalid sub-blocks
                }
            }
        }
    }

    if (results.length > 0) {
        // Return the last one, as it's usually the final decision
        // Priority: objects with 'action' or 'selected_route'
        const decision = results.reverse().find(obj => obj.action || obj.selected_route);
        if (decision) return decision;
        return results[0]; // Fallback to first valid one if no action found
    }

    // 3. Last ditch: original logic for single object
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
        try {
            return JSON.parse(clean.substring(firstBrace, lastBrace + 1));
        } catch (e) {
            console.error('[JSON Parser] Critical Failure:', clean);
            throw e;
        }
    }

    throw new Error('No valid JSON object found in response.');
}

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

    const prompt = buildPrompt(routes);
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });
    const rawText = response.text.trim();

    console.log('[Gemini] Raw response received.');

    // Strip markdown code fences if Gemini wraps the JSON
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try {
        parsed = robustParseJSON(rawText);
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

/**
 * AGENTIC LOGIC: True ReAct Tool-Calling Agent.
 * This function creates a Chat session where Gemini can call tools
 * to investigate the anomaly before making a final decision.
 *
 * @param {Object} trip - The current trip details
 * @param {number} delayMinutes - The current delay in minutes
 * @param {number} currentLat - Live/Simulated Latitude
 * @param {number} currentLng - Live/Simulated Longitude
 * @param {Object} currentRoute - The currently assigned route metrics
 */
export async function evaluateTripAnomaly(trip, delayMinutes, currentLat, currentLng, currentRoute) {
    console.log(`[Gemini Agent] Starting autonomous investigation for Trip ${trip.id} (Delay: ${delayMinutes}m)`);

    const toolsList = [{
        functionDeclarations: [
            {
                name: "get_alternative_routes",
                description: "Fetches alternative routes given the current location and destination coordinates. Returns route_ids.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        currentLat: { type: "NUMBER" },
                        currentLng: { type: "NUMBER" },
                        destLat: { type: "NUMBER" },
                        destLng: { type: "NUMBER" }
                    },
                    required: ["currentLat", "currentLng", "destLat", "destLng"]
                }
            },
            {
                name: "analyze_route_segments",
                description: "Analyzes an alternative route's segments for live traffic density and bad weather conditions. Call this on specific route_ids to verify safety.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        route_id: { type: "STRING" }
                    },
                    required: ["route_id"]
                }
            }
        ]
    }];

    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { 
            tools: toolsList,
            temperature: 0.1 // Keep it deterministic
        }
    });

    const initialPrompt = `You are an autonomous ReAct (Reasoning and Acting) Agent for logistics.
Trip #${trip.id} is experiencing a severe delay of ${delayMinutes} minutes at location [${currentLat}, ${currentLng}].
The destination is [${trip.dest_lat}, ${trip.dest_lng}].
Delivery Deadline: ${currentRoute.deadline_timestamp || 'No hard deadline'}
Current Calculated Slack Time: ${currentRoute.current_slack_hours} hours (Buffer before late arrival).
Current Remaining Distance: ${currentRoute.distance_meters} meters.

INSTRUCTIONS:
1. Call "get_alternative_routes" using the current location and destination.
2. For promising alternatives, call "analyze_route_segments" to check for bottlenecks (max_delay_ratio), overall traffic (avg_delay_ratio), and safety.
3. PERFORM TRADE-OFF ANALYSIS:
   - PRIORITY 1: DEADLINE ADHERENCE. If the "Current Calculated Slack Time" is negative or very low (e.g., < 0.25h), finding a faster route is CRITICAL.
   - Compare the current route's cost (fuel + any toll) and current delay vs alternatives.
   - A route with "max_delay_ratio" > 3.0 is a severe bottleneck (gridlock).
   - "traffic_density_score" > 0.5 indicates widespread congestion.
   - If an alternative saves significant time (e.g. > 15m) but costs 500-1000 INR more, weigh the urgency of the delivery deadline.
4. If no good alternatives exist or they are excessively expensive for minimal gain, decide to "stay_course".

When you have enough information, output ONLY a valid JSON decision (no markdown fences) in this exact format:
{
  "action": "stay_course" | "reroute",
  "reasoning": "Detailed explanation. MUST mention specific costs (INR), time savings (minutes), traffic metrics (avg/max delay), and precisely how this affects the DELIVERY DEADLINE and SLACK TIME.",
  "new_route_id": "<route_id if reroute, else null>"
}
`;

    try {
        let currentResponse = await chat.sendMessage({ message: initialPrompt });

        // Agent Execution Loop (Max 5 iterations to prevent infinite loops)
        for (let i = 0; i < 5; i++) {
            if (currentResponse.functionCalls && currentResponse.functionCalls.length > 0) {
                const call = currentResponse.functionCalls[0];
                console.log(`[Gemini Agent] 🛠️ Calling Tool: ${call.name}`);
                
                let toolResult = {};
                if (call.name === 'get_alternative_routes') {
                    call.args.truckMileage = trip.mileage_kmpl;
                    toolResult = await get_alternative_routes(call.args);
                } else if (call.name === 'analyze_route_segments') {
                    toolResult = await analyze_route_segments(call.args);
                } else {
                    toolResult = { error: "Unknown tool" };
                }

                // Send the result back to the Agent
                currentResponse = await chat.sendMessage({
                    message: [{
                        functionResponse: {
                            name: call.name,
                            response: toolResult
                        }
                    }]
                });
            } else {
                // Agent returned text (final decision)
                const rawText = currentResponse.text.trim();
                const parsed = robustParseJSON(rawText);
                console.log('[Gemini Agent] Final Decision:', parsed.action);
                return parsed;
            }
        }

        console.warn('[Gemini Agent] Loop limit reached without final JSON.');
        return { action: 'stay_course', reasoning: 'Agent timed out investigating.', new_route_id: null };

    } catch (err) {
        console.error('[Gemini Agent] Execution failed:', err);
        return { action: 'stay_course', reasoning: 'Fallback due to agent crash.', new_route_id: null };
    }
}
