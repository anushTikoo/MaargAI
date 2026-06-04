# MaargAI — The Digital Wayfinder for Indian Logistics


---

## What is MaargAI?

MaargAI is an intelligent logistics platform purpose-built for long-haul truck operations in India. It continuously monitors active truck trips using a Gemini 2.5 Flash ReAct agent that evaluates live GPS positions, real-time traffic from the Google Routes Matrix API, and per-segment weather risk from OpenWeatherMap — then autonomously decides whether to keep the truck on its current path or trigger a dynamic reroute, pushing turn-by-turn navigation links directly to the driver's phone.

The platform eliminates the operational blind spots that plague Indian fleet management: route decisions made at dispatch time that go stale within hours, dispatchers with no visibility into what is happening on the road, and drivers who receive no guidance when conditions change. MaargAI closes that loop with a closed-feedback system where every GPS ping can trigger an AI investigation and every AI decision is persisted, auditable, and shown in real time on the fleet dashboard.

---

## Architecture Overview

MaargAI is structured around four layers:

**User Layer** — Fleet managers access the web dashboard (`frontend/`) and drivers use the Android app (`ConstrackerApp/`). Authentication is handled by Google OAuth SSO or email/password, both issuing HMAC-SHA-256 session tokens stored as HttpOnly cookies.

**Client Layer** — The React + Vite dashboard renders a live Google Maps view of all active trips (truck markers, assigned route polylines, breadcrumb trails fetched from PostgreSQL `trip_locations`). The React Native mobile app runs a foreground background service that posts GPS coordinates every 30 seconds to the backend; it also displays AI reroute notifications received in the POST response.

**Application Layer** — An Express 5 server (`backend/server.js`) exposes REST endpoints for auth, truck management, trip management, fleet upload, and weather. It also runs an internal `setInterval` loop every 60 seconds (configured via `MONITORING_INTERVAL_MS = 1 * 60 * 1000` in `server.js:58`) that calls `processActiveTrips()` from `monitoringService.js`.

**Intelligence / Data Layer** — PostgreSQL (Cloud SQL) stores all persistent state: users, trucks, trips, routes, trip segments, trip checkpoints, and trip locations. Firebase Realtime Database is used exclusively for the live GPS stream — the backend writes to `fleet_managers/{fleet_manager_id}/{trip_id}` on every location ping and the dashboard reads from the same path. An in-memory `Map` (`agentTools.js:8`) caches alternative route geometries between tool calls within a single Gemini agent session.

---

## Features

### Fleet Manager Dashboard (`frontend/`)

| Page | Route | Description |
|---|---|---|
| Landing | `/` | Marketing landing page |
| Signup / Login | `/signup` | Email/password or Google SSO authentication |
| Fleet Info | `/fleet-info` | Add trucks individually or bulk-import via Excel |
| Overview / Live Map | `/dashboard` | Google Maps view of all active trips with live truck markers, route polylines, and breadcrumb history |
| Vehicle List | `/vehicle-list` | Full fleet roster — add, edit, delete trucks with optional advanced specs |
| Shipments | `/shipments` | Create trips (source + destination via Places autocomplete, optional deadline), view trip list, open per-trip Route Intelligence panel |

**Key capabilities:**
- **Live map** — Fetches `/api/trips/active-map` and overlays truck positions read from Firebase RTDB, with the last 50 breadcrumb points from `trip_locations`
- **Route Intelligence panel** — Calls `/api/trips/:id/intelligence` to render per-route segment heatmaps, reliability scores, cost estimates, and the AI's selected route
- **Bulk fleet upload** — Accepts `.xls` / `.xlsx` files (max 50 MB), parses them with `xlsx`, sends columns and rows to Gemini 2.5 Flash in batches of up to 80 rows, and upserts the mapped truck records to PostgreSQL
- **Google SSO** — OAuth2 flow via `google-auth-library`; after callback, a short-lived handoff code (5-minute TTL, `authHandoff.js:3`) bridges the server-side redirect to the SPA cookie

### ConstrackerApp (`ConstrackerApp/`)

- **Truck number as token** — The driver enters their truck number as the user ID; this is sent as `token` with every location POST and resolved server-side to a truck and trip record
- **Live GPS tracking** — Uses `react-native-geolocation-service` with `enableHighAccuracy: true` inside a `react-native-background-actions` foreground service; GPS interval is 30 000 ms (`constants.js:6`)
- **Manual location override** — For demo/testing: driver enters lat/lng manually; the app enters a continuous repeat mode at the same 30 000 ms interval, sending the fixed coordinates until stopped
- **Route update banner** — Every POST response is inspected for `trip.ai_recommendation.google_maps_url`; if present (and after ≥ 2 successful posts), the app shows a dismissable "Route Update" banner with an **Open Link** button that opens Google Maps in turn-by-turn navigation mode
- **Auto trip lifecycle** — The backend activates the trip when the truck is within 250 m of the source and marks it completed when within 250 m of the destination; the app receives the updated status in the POST response

### AI Engine — Gemini ReAct Agent (`backend/services/geminiService.js`)

- **Two-stage AI** — (1) At activation: `getAIRouteRecommendation()` calls `gemini-2.5-flash` with a structured prompt listing all candidate routes with reliability scores, ETAs, fuel costs, and slack time; Gemini picks the best route. (2) During monitoring: `evaluateTripAnomaly()` runs a full ReAct loop with tool calling.
- **Tool-calling loop** — Up to 5 iterations (`geminiService.js:311`). Tools available: `get_alternative_routes` (calls Google Routes API, caches geometry) and `analyze_route_segments` (samples up to 6 segments, fetches traffic + weather for each)
- **Temperature** — Agent runs at `temperature: 0.1` for near-deterministic decisions (`geminiService.js:240`)
- **Concurrent-cycle guard** — Before calling Gemini, re-reads `last_ai_trigger_at` from DB; skips if another cycle already triggered AI within 2 minutes (`monitoringService.js:357`)
- **Reroute stitching** — When a reroute is saved, the old polyline history (origin → current truck position) is stitched with the new future path using `encodePolyline` / `decodePolyline` (`monitoringService.js:437–455`)

### Core Intelligence Layer — Monitoring Loop (`backend/services/monitoringService.js`)

- **Worker interval** — 60 seconds (`server.js:58`); only processes trips where `last_checked_at < NOW() - INTERVAL '1 minute'` to prevent double-processing
- **Four trigger conditions** — evaluated in priority order per trip per cycle:
  1. **Delay** — dynamic threshold based on slack (see Scoring section)
  2. **Risk spike** — lightweight reliability check on 3 sampled segments; fires if score ≥ 0.7 AND delta from previous score ≥ 0.3
  3. **Deviation** — truck is > 500 m from the assigned polyline (`segmentationService.js:166`)
  4. **Opportunity scan** — 30-minute gap since last AI call (`monitoringService.js:20`)
- **Route match logic** — Matches Google's live route to the AI-chosen polyline by finding the closest distance match within 5% tolerance (or 500 m minimum) of expected remaining distance
- **Segment enrichment** — On trip activation, all route segments receive live traffic durations via Google Routes Matrix API and weather scores via OpenWeatherMap; this populates `delay_ratio` and `weather_score` in `trip_segments`

---

## Scoring & Formula Reference

### 1. `delay_ratio` — Per-Segment Traffic Delay Factor

**Location:** `backend/routes/trips.js:516–518` (`enrichTripSegments`)

**Formula:**
```
delay_ratio = duration_in_traffic_seconds / avg_segment_time
```
Where:
- `duration_in_traffic_seconds` — live traffic duration from Google Routes Matrix API (`routingPreference: TRAFFIC_AWARE`)
- `avg_segment_time = route.duration_seconds / total_segments` — baseline time per segment assuming uniform distribution

**Output range:** `1.0` = no delay. `1.5` = 50% slower than baseline (threshold for "heavy congestion", `trips.js:357`). `3.0+` = gridlock (cited in agent prompt as avoid threshold, `geminiService.js:286`).

**Consumed by:** `reliability_score` computation (trips.js), `computeLightweightReliability` (monitoringService.js), `analyze_route_segments` tool (agentTools.js).

---

### 2. `reliability_score` (Maarg Index) — Composite Route Risk Score

**Location:** `backend/routes/trips.js:376–394` (`routeAnalyses` map) and `trips.js:588–593` (`enrichTripSegments` → Gemini payload)

**Formula:**
```
excessAvg  = max(0, avg_delay_ratio − 1)
excessMax  = max(0, max_delay_ratio − 1)
density    = congestion_density          (fraction of segments with delay_ratio > 1.5)
avgWeather = avg weather_score across segments
maxWeather = max weather_score across segments

trafficRisk  = (excessAvg × 0.40) + (excessMax × 0.30) + (density × 0.20)
weatherRisk  = (avgWeather × 0.10) + (maxWeather × 0.30)

reliability_score = trafficRisk + weatherRisk
```

All inputs sourced from `trip_segments` rows after enrichment. Weather inputs sourced from `weatherService.computeWeatherScore()`.

**Output range & thresholds:**
- `0.0 – 0.3` → `stable` (low risk)
- `0.3 – 0.7` → `risky` (medium risk)
- `0.7+` → `unstable` (high risk)

**Consumed by:** Gemini route recommendation prompt (`geminiService.js:90–93`), `RELIABILITY_SPIKE_ABSOLUTE_MIN = 0.7` trigger in monitoring loop (`monitoringService.js:16`), `ai_risk_level` field stored on routes (`low` / `medium` / `high` at `trips.js:642`).

---

### 3. `congestion_density` — Fraction of Congested Segments

**Location:** `backend/routes/trips.js:357–358`

**Formula:**
```
congestion_density = count(segments where delay_ratio > 1.5) / total_analyzed_segments
```

**Output range:** `0.0` (no congestion) to `1.0` (all segments congested). Values `> 0.5` are flagged in the agent prompt as "widespread congestion — prefer alternatives" (`geminiService.js:287`).

**Consumed by:** `reliability_score` formula (weight 0.20), `analyze_route_segments` tool output (`agentTools.js:138`).

---

### 4. `weather_score` — Per-Segment Weather Risk Score

**Location:** `backend/services/weatherService.js:61–93` (`computeWeatherScore`)

**Formula:**
```
Base score by OpenWeatherMap weather.main:
  Clear / Clouds / Atmosphere  → 0.0
  Drizzle / Rain (rain_1h < 2mm) → 0.3
  Rain (rain_1h 2–10mm)         → 0.5
  Rain (rain_1h ≥ 10mm)         → 0.7
  Snow                           → 0.6
  Thunderstorm                   → 1.0

Additive penalties:
  visibility < 500m              → +0.3
  wind_speed > 15 m/s            → +0.2

weather_score = min(base + penalties, 1.3)
```

Inputs: `data.weather[0].main`, `data.rain['1h']`, `data.visibility`, `data.wind.speed` — all from OpenWeatherMap `/data/2.5/weather` response.

**Output range:** `0.0` (perfect conditions) to `1.3` (theoretical max: thunderstorm + zero visibility + high wind). Threshold for "bad weather segment" in `analyze_route_segments` tool: `score > 0.5` (`agentTools.js:117`).

**Consumed by:** `reliability_score` formula (weights 0.10 avg + 0.30 max), stored as `weather_score` and `weather_main` in `trip_segments`, surfaced in Route Intelligence panel.

---

### 5. `computeLightweightReliability` — Traffic-Only Trigger Score

**Location:** `backend/services/monitoringService.js:305–341`

**Formula (traffic-only subset of full reliability_score):**
```
Samples up to 3 evenly-spaced segments from current route polyline.

avgSegmentTime = (route total distance in km × 60) / total_segments   [minutes]

avgDelayRatio = mean(trafficDuration[i]) / (samples × avgSegmentTime)
maxDelayRatio = max(trafficDuration[i] / avgSegmentTime)

reliability = (min(avgDelayRatio − 1, 1.0) × 0.40) + (min(maxDelayRatio − 1, 1.5) × 0.30)
reliability = max(0, reliability)
```

**Output range:** `0.0` to `~1.05` (traffic-only). Trigger fires when `reliability >= 0.7` AND delta from previous stored `last_route_reliability >= 0.3` (`monitoringService.js:257`).

**Consumed by:** Trigger 2 (risk spike) in `evaluateTriggers`. Result persisted to `trips.last_route_reliability` after each cycle.

---

### 6. `delayMinutes` — Live Trip Delay

**Location:** `backend/services/monitoringService.js:148–154`

**Formula:**
```
secondsElapsed       = (Date.now() − trip.created_at) / 1000
expectedRemaining    = max(0, baseline_eta_seconds − secondsElapsed)
totalDelaySeconds    = max(0, liveEtaSeconds − expectedRemaining)
delayMinutes         = floor(totalDelaySeconds / 60)
```

Where:
- `baseline_eta_seconds` — traffic-adjusted ETA set at trip activation by Gemini (`trips.js:671`)
- `liveEtaSeconds` — Google Routes API `TRAFFIC_AWARE` duration for the matched route at the current monitoring cycle
- `trip.created_at` — reset to `CURRENT_TIMESTAMP` at activation (`trips.js:672`) so elapsed time counts from trip start, not creation

**Consumed by:** All four trigger threshold comparisons; passed to `evaluateTripAnomaly` as `delayMinutes` context for the agent prompt.

---

### 7. `liveSlackTimeHours` — Buffer to Deadline

**Location:** `backend/services/monitoringService.js:156–162`

**Formula:**
```
predictedArrivalMs = Date.now() + (liveEtaSeconds × 1000)
slackMs            = deadline_timestamp − predictedArrivalMs
liveSlackTimeHours = slackMs / 3_600_000
```

**Output range:** Positive = buffer remaining. Negative = already overdue. Thresholds used in the system:
- `< 0` → overdue (agent prompt: "CRITICAL, optimise for speed")
- `0 – 0.25h` (15 min) → critical (`trips.js:416`)
- `0.25 – 3h` → low slack
- `> 3h` → ample slack (agent should not reroute unless cost + risk both improve)

**Consumed by:** `computeDelayThreshold` (selects which delay threshold to use), Gemini agent prompt slack label, `deadline_analysis.status` in Route Intelligence response.

---

### 8. `computeDelayThreshold` — Dynamic Delay Trigger Threshold

**Location:** `backend/services/monitoringService.js:293–297`

**Formula:**
```
if no deadline set          → threshold = 20 minutes   (DELAY_THRESHOLD_NO_DEADLINE)
if liveSlackTimeHours < 0.5 → threshold = 10 minutes   (DELAY_THRESHOLD_TIGHT_SLACK)
otherwise                   → threshold = 15 minutes   (DELAY_THRESHOLD_NORMAL_SLACK)
```

Constants defined at `monitoringService.js:11–13`.

**Consumed by:** Trigger 1 (delay) in `evaluateTriggers`.

---

### 9. `fuelCost` — Route Fuel Cost Estimate (INR)

**Location:** `backend/routes/trips.js:398`, `backend/services/agentTools.js:39`, `backend/services/monitoringService.js:434`

**Formula:**
```
fuelCost_INR = (distance_meters / 1000 / mileage_kmpl) × 90
```

Where:
- `distance_meters` — route distance from Google Routes API
- `mileage_kmpl` — truck's `mileage_kmpl` from the `trucks` table (defaults per type in `truckPersistence.js:1–7`: mini=18, light=10, medium=6, heavy=4, trailer=3)
- `90` — hardcoded fuel price per litre in INR (`trips.js:290`, `trips.js:557`, `agentTools.js:39`)

**Consumed by:** Gemini route recommendation payload (`fuel_cost_inr`), `ai_fuel_cost_inr` stored on routes, `ai_total_cost_inr = fuel_cost + toll_cost`.

---

### 10. `tollCost` — Route Toll Cost Estimate (INR)

**Location:** `backend/services/routesService.js:97–104`, `backend/services/agentTools.js:40`

**Formula:**
```
If Google Routes API provides travelAdvisory.tollInfo.estimatedPrice:
  tollCost = price.units + (price.nanos / 1_000_000_000)   [in native currency]

If no API-provided toll cost but hasTolls flag is true (agent tool):
  tollCost = 450   [simulated, agentTools.js:40]

If no tolls:
  tollCost = 0
```

**Consumed by:** `ai_total_cost_inr`, Gemini recommendation payload `toll_cost_inr` (null when not available from API, treated conservatively per agent decision rules).

---

### 11. Deviation Detection Threshold

**Location:** `backend/services/segmentationService.js:166`

```
isNear = (minDistanceToPolylinePoint <= 500 meters)
isDeviated = !isNear
```

Where `minDistanceToPolyline` uses the Haversine formula (`calculateDistanceMeters`) against every decoded polyline point, finding the nearest.

**Consumed by:** Trigger 3 (deviation) in `evaluateTriggers`, `isActuallyOptimized` flag returned to ConstrackerApp in POST `/api/trips/locations` response.

---

### 12. Trip Activation / Completion Radius

**Location:** `backend/routes/trips.js:11–12`

```
START_TRIP_RADIUS_METERS    = 250
COMPLETE_TRIP_RADIUS_METERS = 250
```

Both use the Haversine formula (`calculateDistanceMeters` in `trips.js:18–33`). Trip activates when driver is within 250 m of `source_lat/source_lng`; trip completes when within 250 m of `dest_lat/dest_lng`.

---

### 13. Dynamic Segment Size

**Location:** `backend/services/agentTools.js:80`, `backend/services/monitoringService.js:313`, `backend/routes/trips.js:1239`

```
segmentSizeKm = max(8, min(20, totalDistanceKm × 0.10))
```

Ensures segments are 10% of total route distance, clamped between 8 km and 20 km.

**Consumed by:** `segmentRoute()` in `segmentationService.js`, which slices decoded polyline points into segments of approximately `segmentSizeKm` each using cumulative Haversine distance.

---

### 14. Route Match Tolerance (Monitoring Loop)

**Location:** `backend/services/monitoringService.js:128`

```
matchTolerance = max(500, expectedRemainingMeters × 0.05)
```

If the best-matching Google route differs by more than 5% of expected remaining distance (or 500 m minimum), the match is rejected and the AI's canonical ETA is preserved instead of being overwritten.

---

## Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| **Frontend** | React | 19.2.4 |
| | React Router DOM | 7.14.1 |
| | Vite | 8.0.4 |
| | Tailwind CSS | 4.2.2 (via `@tailwindcss/vite`) |
| | Firebase JS SDK | 12.12.1 (RTDB live location read) |
| | Google Maps JS API | Loaded via `index.html` with `places,marker` libraries |
| **Mobile** | React Native | 0.85.2 |
| | react-native-geolocation-service | 5.3.1 |
| | react-native-background-actions | 4.1.0 |
| | react-native-safe-area-context | 5.5.2 |
| | TypeScript | 5.8.3 |
| **Backend** | Node.js | ESM (`"type": "module"`) |
| | Express | 5.2.1 |
| | `pg` (node-postgres) | 8.20.0 |
| | `firebase-admin` | 13.8.0 |
| | `@google/genai` | 1.50.1 |
| | `@google/generative-ai` | 0.24.1 |
| | `google-auth-library` | 10.6.2 |
| | `bcrypt` | 6.0.0 |
| | `multer` | 2.1.1 |
| | `xlsx` | 0.18.5 |
| | `dotenv` | 17.4.2 |
| **AI / External APIs** | Gemini 2.5 Flash | Route recommendation + ReAct agent |
| | Google Routes API v2 | `computeRoutes` + `computeRouteMatrix` |
| | Google Places API | Autocomplete in trip creation |
| | OpenWeatherMap API | `/data/2.5/weather` current conditions |
| | Google OAuth 2.0 | SSO via `google-auth-library` |
| **Infrastructure** | Google Cloud Run | Backend deployed at `maargai-backend-678795712749.asia-south1.run.app` |
| | Firebase Hosting | Frontend at `upbeat-cosine-457405-n0.web.app` |
| | Firebase Realtime DB | Live GPS stream only (`asia-southeast1` region) |
| | Google Cloud SQL | PostgreSQL — persistent trip/fleet data |

---

## Repository Structure

```
MaargAI/
├── backend/
│   ├── server.js                   # Express entry point + internal monitoring setInterval
│   ├── db.js                       # pg Pool — reads DATABASE_URL
│   ├── init.sql                    # Full schema: users, trucks, trips, routes,
│   │                               #   trip_segments, trip_checkpoints, trip_locations
│   ├── .env                        # Backend environment variables (see reference below)
│   ├── package.json
│   ├── middleware/
│   │   └── requireAuth.js          # HMAC token verification middleware
│   ├── routes/
│   │   ├── basicAuth.js            # POST /register, POST /login, GET /me, POST /logout
│   │   ├── googleAuth.js           # GET /google, GET /google/callback, POST /google/exchange
│   │   ├── trips.js                # All trip endpoints (1332 lines)
│   │   ├── trucks.js               # CRUD for trucks
│   │   ├── fleetUpload.js          # POST /fleet/excel-to-json
│   │   ├── weather.js              # GET /weather
│   │   └── worker.js               # POST /worker/process-active-trips
│   ├── services/
│   │   ├── geminiService.js        # getAIRouteRecommendation + evaluateTripAnomaly (ReAct)
│   │   ├── monitoringService.js    # processActiveTrips + 4-trigger engine
│   │   ├── agentTools.js           # get_alternative_routes + analyze_route_segments tools
│   │   ├── routesService.js        # Google Routes API v2 wrapper
│   │   ├── trafficService.js       # Google Routes Matrix API (traffic durations)
│   │   ├── weatherService.js       # OpenWeatherMap wrapper + computeWeatherScore
│   │   ├── segmentationService.js  # decodePolyline, encodePolyline, segmentRoute,
│   │   │                           #   getDistanceToPolyline, calculateDistanceMeters
│   │   └── firebase.js             # firebase-admin RTDB init
│   └── utils/
│       ├── authSession.js          # HMAC-SHA-256 token create/verify, cookie serialization
│       ├── authHandoff.js          # Short-lived (5 min) in-memory OAuth handoff codes
│       ├── geminiTruckMapper.js    # Excel → Gemini → truck field mapping (batched, 80 rows)
│       └── truckPersistence.js     # buildTruckPayload + insertTruckRecord with defaults
│
├── frontend/
│   ├── index.html                  # Google Maps JS API script tag, Inter font
│   ├── vite.config.js
│   ├── package.json
│   ├── .env                        # Frontend environment variables
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                 # React Router: /, /signup, /dashboard, /fleet-info,
│       │                           #   /vehicle-list, /shipments
│       ├── index.css
│       ├── guards/
│       │   └── ProtectedRoute.jsx  # Auth guard — redirects unauthenticated users
│       ├── pages/
│       │   ├── Landing.jsx
│       │   ├── Signup.jsx
│       │   ├── Home.jsx            # Shell layout with navigation
│       │   ├── Overview.jsx        # Live map dashboard
│       │   ├── FleetInfo.jsx       # Fleet management + Excel upload
│       │   ├── VehicleList.jsx     # Truck list with edit/delete
│       │   └── Shipments.jsx       # Trip creation + Route Intelligence panel
│       └── services/
│           ├── authService.js
│           ├── tripsService.js
│           ├── trucksService.js
│           ├── fleetUploadService.js
│           └── firebase.js         # Firebase JS SDK RTDB init
│
└── ConstrackerApp/
    ├── App.tsx                     # Single-screen React Native app (564 lines)
    ├── index.js
    ├── package.json
    └── android/src/
        ├── config/
        │   └── constants.js        # API_URL + LOCATION_CONFIG (interval: 30000ms)
        ├── permissions/
        │   └── locationPermission  # Android runtime location permission request
        └── services/
            ├── apiService.js       # sendLocation() — POST to /api/trips/locations
            └── locationService.js  # startLocationTracking / stopLocationTracking
                                    #   (react-native-background-actions foreground service)
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 22.11.0
- **PostgreSQL** instance (local or Cloud SQL)
- **Android Studio** (for ConstrackerApp)
- API keys: Gemini, Google Maps (server-side, no referrer restriction), Google Places (browser-side), OpenWeatherMap, Google OAuth client
- Firebase project with Realtime Database enabled

---

### Backend

```bash
cd backend
npm install
```

Copy `.env` and fill in all values (see Environment Variables Reference below):

```bash
# Start the server
npm start
# Server runs on PORT (default 3000)
```

Before first run, initialize the database schema:

```bash
psql -d <your_db> -f init.sql
```

---

### Frontend

```bash
cd frontend
npm install
```

Create a `.env` file with the keys listed in the reference below, then:

```bash
npm run dev       # development server (Vite, default port 5173)
npm run build     # production bundle
npm run preview   # preview production build
```

---

### ConstrackerApp

```bash
cd ConstrackerApp
npm install
```

Edit `android/src/config/constants.js` — set `API_URL` to your backend URL:

```js
export const API_URL = "https://<your-backend>/api/trips/locations";
```

```bash
# Start Metro bundler
npm start

# Run on Android device / emulator
npm run android
```

---

## Environment Variables Reference

### `backend/.env`

| Key | Description |
|---|---|
| `PORT` | Express server port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/MaargAI`) |
| `CLIENT_URL` | CORS allowed origin and OAuth redirect base (e.g. `http://localhost:5173`) |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL (e.g. `http://localhost:3000/api/auth/google/callback`) |
| `GEMINI_API_KEY` | Gemini API key — used by `geminiService.js`, `geminiTruckMapper.js` |
| `GEMINI_MODEL` | Gemini model for Excel mapping (default `gemini-2.5-flash`) |
| `GEMINI_MAX_ROWS_PER_BATCH` | Max Excel rows per Gemini batch call (default `80`) |
| `GOOGLE_MAPS_API_KEY` | Server-side Maps key — used for Routes API v2 and Routes Matrix API. Must have no HTTP referrer restriction. |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin SDK service account email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK private key (PEM, with `\n` escaped as `\\n`) |
| `FIREBASE_DB_URL` | Firebase Realtime Database URL |
| `AUTH_TOKEN_SECRET` | HMAC-SHA-256 secret for session tokens (falls back to `maargai-dev-auth-secret` if unset — set this in production) |

### `frontend/.env`

| Key | Description |
|---|---|
| `VITE_BACKEND_URL` | Backend base URL (e.g. `https://maargai-backend-678795712749.asia-south1.run.app`) |
| `VITE_GOOGLE_PLACES_API_KEY` | Browser-side Places API key for autocomplete in trip creation form |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser-side Maps JS API key (loaded in `index.html` with `libraries=places,marker`) |
| `VITE_FIREBASE_API_KEY` | Firebase web app API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_DB_URL` | Firebase Realtime Database URL (used by frontend Firebase JS SDK for live location reads) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

### `ConstrackerApp/android/src/config/constants.js`

There is no `.env` file for ConstrackerApp. Configuration is hardcoded in `constants.js`:

| Constant | Current value | Description |
|---|---|---|
| `API_URL` | `https://maargai-backend-.../api/trips/locations` | Backend endpoint for location POSTs |
| `LOCATION_CONFIG.enableHighAccuracy` | `true` | Forces GPS (not network) positioning |
| `LOCATION_CONFIG.distanceFilter` | `100` (meters) | Minimum movement before triggering a location update |
| `LOCATION_CONFIG.interval` | `30000` (ms) | GPS + POST interval for both live and manual-repeat modes |
| `LOCATION_CONFIG.fastestInterval` | `2000` (ms) | Minimum interval between location callbacks |

---

## How It Works

The following is the end-to-end flow derived from the actual code:

1. **Trip Creation** (`POST /api/trips/create-trip`)
   - Fleet manager selects a truck and enters source/destination (Places autocomplete) and optional deadline
   - Backend calls Google Routes API v2 (`computeRoutes`, `TRAFFIC_AWARE`, `computeAlternativeRoutes: true`, `extraComputations: ['TOLLS']`)
   - All returned routes are inserted into `routes` table with indices `A`, `B`, `C`, …
   - Each route's polyline is decoded and sliced into segments (`segmentSizeKm = max(8, min(20, distKm × 0.1))`); segment geometry is bulk-inserted into `trip_segments` (traffic/weather columns remain null at this stage)
   - Baseline ETA and distance are stored on the trip from Route A; `current_route_id` remains `NULL` — Gemini has not decided yet

2. **Trip Activation** (`POST /api/trips/locations` — first ping within 250 m of source)
   - Driver opens ConstrackerApp, enters truck number, starts tracking
   - On the first POST where `distanceToSource <= 250 m`, the backend sets `status = 'active'`
   - `enrichTripSegments(tripId)` is fired asynchronously (non-blocking)

3. **Post-Activation Enrichment** (`enrichTripSegments` in `trips.js:464`)
   - For each route: fetches live traffic durations for all segments via Google Routes Matrix API (`TRAFFIC_AWARE`)
   - Fetches weather scores for up to 6 sampled segment midpoints via OpenWeatherMap
   - Computes `delay_ratio` and `weather_score` for each segment and writes to `trip_segments`
   - Builds Gemini payload: computes `reliability_score`, `eta_hours` (traffic-adjusted), `fuel_cost_inr`, `toll_cost_inr`, `slack_time_hours` per route
   - Calls `getAIRouteRecommendation()` — Gemini 2.5 Flash picks the best route using the decision rules in the prompt
   - Writes `is_ai_recommended = true` on the winning route, updates `current_route_id` on the trip, sets `baseline_eta_seconds` to the traffic-adjusted ETA of the chosen route, and resets `created_at` to `CURRENT_TIMESTAMP` (so the delay clock starts from now)

4. **Continuous GPS Tracking** (`POST /api/trips/locations` — subsequent pings)
   - Every 30 seconds the app POSTs `{ token, lat, lng }`
   - Backend writes to `trip_locations` (breadcrumb history) and `trips.last_gps_lat/lng`
   - Location is pushed to Firebase RTDB at `fleet_managers/{fleet_manager_id}/{trip_id}` for the live dashboard
   - Response includes `ai_recommendation.google_maps_url` — the driver's turn-by-turn Google Maps link built from the assigned route's remaining polyline waypoints
   - Deviation is instantly checked (`getDistanceToPolyline`); if > 500 m, `is_ai_optimized` is set to `false` in the response

5. **Background Monitoring Loop** (`server.js:58–79`)
   - Fires every 60 seconds via `setInterval`
   - Queries all `status = 'active'` trips where `current_route_id IS NOT NULL` AND `ai_decision IS NOT NULL` AND `last_checked_at < NOW() - INTERVAL '1 minute'`
   - For each trip: fetches live ETA from Google Routes, refreshes segment traffic data, matches the live route to the AI-chosen polyline (within 5% tolerance), computes delay and slack, inserts a `trip_checkpoints` row

6. **Trigger Evaluation** (`evaluateTriggers` in `monitoringService.js:233`)
   - Evaluates four triggers in order (only one fires per cycle per trip):
     - **Trigger 1 — Delay:** `delayMinutes > threshold` (10 / 15 / 20 min depending on slack)
     - **Trigger 2 — Risk Spike:** lightweight 3-segment traffic check; fires if `score >= 0.7` AND `delta >= 0.3` from previous baseline
     - **Trigger 3 — Deviation:** truck > 500 m off the assigned polyline
     - **Trigger 4 — Opportunity:** > 30 minutes since last AI call

7. **Gemini ReAct Agent Invocation** (`evaluateTripAnomaly` in `geminiService.js:202`)
   - Concurrent-cycle guard: skips if AI was triggered within the last 2 minutes
   - Sends initial prompt with trigger context, current position, delay, slack, and decision framework
   - Agent loop (max 5 iterations):
     - Agent calls `get_alternative_routes` → backend fetches Google Routes, caches polylines in-memory, returns route summaries with fuel/toll estimates
     - Agent calls `analyze_route_segments` on candidate routes → backend fetches traffic (up to 6 segments) and weather (up to 6 segments) in parallel, returns `avg_delay_ratio`, `max_delay_ratio`, `traffic_density_score`, `bad_weather_segments`
     - Agent applies the decision framework (deadline safety → stability → risk → cost) and outputs `{ action, reasoning, new_route_id }`
   - Falls back to `stay_course` on loop limit or crash

8. **Reroute Persistence & Driver Notification** (`handleReroute` in `monitoringService.js:405`)
   - Checks if the chosen geometry is already in `routes` for this trip (deduplication)
   - If new: inserts the route with fuel/toll costs; stitches old history polyline (origin → current position) with new future polyline
   - Updates `trips.current_route_id`, `ai_decision = 'reroute'`, `ai_reroute_reason`, `live_eta_seconds`
   - On the driver's next POST, the updated `current_route_id` is used to build a fresh Google Maps navigation URL; the banner appears in the app

9. **Trip Completion** (`POST /api/trips/locations`)
   - When `distanceToDestination <= 250 m`, `status` is set to `'completed'`
   - Firebase RTDB node for this trip is deleted (`realtimeDB.ref(...).remove()`)

---

## API Reference

All routes are prefixed with `/api`.

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register with email + password |
| `POST` | `/api/auth/login` | Login with email + password |
| `GET` | `/api/auth/me` | Return current authenticated user (requires auth) |
| `POST` | `/api/auth/logout` | Clear auth cookie |
| `GET` | `/api/auth/google` | Redirect to Google OAuth consent screen |
| `GET` | `/api/auth/google/callback` | Google OAuth callback; redirects to frontend with handoff code |
| `POST` | `/api/auth/google/exchange` | Exchange handoff code for auth cookie |

### Trucks

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/trucks` | List all trucks (optionally filter by `fleet_manager_id`) |
| `GET` | `/api/trucks/:id` | Get a single truck by ID |
| `POST` | `/api/trucks` | Add a truck (auto-infers type + defaults from `capacity_kg`) |
| `PUT` | `/api/trucks/:id` | Update a truck |
| `DELETE` | `/api/trucks/:id` | Delete a truck |

### Trips

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/trips` | List all trips for a fleet manager |
| `POST` | `/api/trips/create-trip` | Create a trip (fetches routes, inserts segments) |
| `GET` | `/api/trips/active-map` | Active trips with live Firebase locations + breadcrumbs |
| `GET` | `/api/trips/test-routes` | Test Google Routes API for a source/destination pair |
| `GET` | `/api/trips/:id/intelligence` | Per-route segment metrics + reliability scores + deadline analysis |
| `GET` | `/api/trips/:trip_id/routes` | All routes for a trip |
| `GET` | `/api/trips/:trip_id/locations` | Full breadcrumb history for a trip |
| `POST` | `/api/trips/locations` | Driver GPS ping — activates/completes trip, updates Firebase, returns navigation URL |
| `DELETE` | `/api/trips/:trip_id` | Delete a trip |

### Fleet Upload

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/fleet/excel-to-json` | Upload `.xls`/`.xlsx` (max 50 MB); Gemini maps columns to truck schema and inserts records |

### Weather

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/weather` | Get current weather for `?lat=&lon=` (proxies OpenWeatherMap) |

### Worker

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/worker/status` | Last run stats for the internal monitoring loop |
| `POST` | `/api/worker/process-active-trips` | Manually trigger the monitoring loop (also called by Cloud Scheduler) |

---

## Deployment

The backend is deployed on **Google Cloud Run** (`asia-south1` region). The frontend is hosted on **Firebase Hosting**.

**Backend deployment notes:**
- Set all environment variables (see reference above) as Cloud Run secrets or environment variables — never commit `.env` to source control
- `DATABASE_URL` should point to Cloud SQL via the Cloud SQL Auth Proxy connector or the public IP with SSL
- `FIREBASE_PRIVATE_KEY` must have literal newlines; in Cloud Run environment variables, store the raw PEM (no `\\n` escaping needed)
- The internal `setInterval` monitoring loop runs inside the Cloud Run container process; ensure the minimum instance count is ≥ 1 to prevent the loop from being killed during idle scale-to-zero
- `POST /api/worker/process-active-trips` can be invoked by Cloud Scheduler as a redundant external trigger

**Data architecture:**
- **PostgreSQL (Cloud SQL)** — all persistent state: users, trucks, trips, routes, segments, checkpoints, breadcrumb history
- **Firebase Realtime Database** — live GPS only; data lives at `fleet_managers/{fleet_manager_id}/{trip_id}` and is deleted on trip completion
- **In-memory `Map`** (`agentTools.js:8`) — alternative route geometries cached for the duration of a single Gemini agent session; not shared across Cloud Run instances

**Frontend deployment:**
```bash
cd frontend
npm run build
firebase deploy --only hosting
```

---