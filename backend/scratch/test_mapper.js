
function toStringOrNull(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const rawValue = String(value).trim().replace(/,/g, '');
    if (!rawValue) return null;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
}

function toIntegerOrNull(value) {
    const n = toNumberOrNull(value);
    if (n === null) return null;
    const i = Math.trunc(n);
    return Number.isFinite(i) ? i : null;
}

function headerMatches(header, pattern) {
    const h = String(header || '').toLowerCase().replace(/\s+/g, '_');
    return pattern.test(h);
}

// Mocking some of the logic from geminiTripMapper.js to test inferFromRawRow improvements
function inferFromRawRow(columns, row) {
    const headers = (Array.isArray(columns) ? columns : []).map((c) => toStringOrNull(c)?.toLowerCase() || '');
    const values = Array.isArray(row) ? row : [];

    let truckId = null;
    let truckNumber = null;
    let sourceLat = null;
    let sourceLng = null;
    let destLat = null;
    let destLng = null;
    let deadline = null;

    // We'll use the NEW regexes here to verify they work
    const truckNumRegex = /truck[_\s-]*(number|no|#|reg|ref)/;
    const sourceLatRegex = /(source|origin|pickup|from|start).*(lat|latitude)/;
    const sourceLatRegexShort = /^(src|pick|start)_?lat$/;
    const sourceLngRegex = /(source|origin|pickup|from|start).*(lng|lon|long)/;
    const sourceLngRegexShort = /^(src|pick|start)_?(lng|lon)$/;
    const destLatRegex = /(dest|destination|drop|delivery|to|end).*(lat|latitude)/;
    const destLatRegexShort = /^(dest|end)_?lat$/;
    const destLngRegex = /(dest|destination|drop|delivery|to|end).*(lng|lon|long)/;
    const destLngRegexShort = /^(dest|end)_?(lng|lon)$/;
    const deadlineRegex = /deadline|due|eta|delivery[_\s-]*(time|date)|delivery/;

    for (let index = 0; index < values.length; index += 1) {
        const header = headers[index] || '';
        const value = values[index];

        if (truckId === null && headerMatches(header, /truck[_\s-]*id/)) {
            truckId = toIntegerOrNull(value);
        }
        if (truckNumber === null && headerMatches(header, truckNumRegex)) {
            truckNumber = toStringOrNull(value);
        }
        if (
            sourceLat === null &&
            (headerMatches(header, sourceLatRegex) || headerMatches(header, sourceLatRegexShort))
        ) {
            sourceLat = toNumberOrNull(value);
        }
        if (
            sourceLng === null &&
            (headerMatches(header, sourceLngRegex) || headerMatches(header, sourceLngRegexShort))
        ) {
            sourceLng = toNumberOrNull(value);
        }
        if (
            destLat === null &&
            (headerMatches(header, destLatRegex) || headerMatches(header, destLatRegexShort))
        ) {
            destLat = toNumberOrNull(value);
        }
        if (
            destLng === null &&
            (headerMatches(header, destLngRegex) || headerMatches(header, destLngRegexShort))
        ) {
            destLng = toNumberOrNull(value);
        }
        if (deadline === null && headerMatches(header, deadlineRegex)) {
            deadline = value;
        }
    }

    return {
        truck_id: truckId,
        truck_number: truckNumber,
        source_lat: sourceLat,
        source_lng: sourceLng,
        dest_lat: destLat,
        dest_lng: destLng,
        deadline_timestamp: deadline,
    };
}

// Test case based on user's screenshot
const testColumns = [
    "Fleet Manager", 
    "Truck Ref", 
    "Start Latitude", 
    "Start Longitude", 
    "End Latitude", 
    "End Longitude", 
    "Delivery Date", 
    "Priority Level"
];
const testRow = [3, 4, 23.25971, 77.47174, 22.27964, 74.12717, "2026-04-20", "low"];

const result = inferFromRawRow(testColumns, testRow);
console.log("Mapping Result:", JSON.stringify(result, null, 2));

const expectedKeys = ['source_lat', 'source_lng', 'dest_lat', 'dest_lng', 'truck_number', 'deadline_timestamp'];
const missing = expectedKeys.filter(key => result[key] === null);

if (missing.length === 0) {
    console.log("SUCCESS: All fields mapped correctly!");
} else {
    console.log("FAILURE: Missing fields:", missing);
}
