const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_BATCH_SIZE = 80;

function stripCodeFences(rawText = '') {
    const trimmed = String(rawText).trim();

    if (!trimmed.startsWith('```')) {
        return trimmed;
    }

    return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
}

function parseJsonFromGemini(rawText) {
    const cleaned = stripCodeFences(rawText);
    return JSON.parse(cleaned);
}

function toNumberOrNull(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const rawValue = String(value).trim();

    if (!rawValue) {
        return null;
    }

    const normalized = rawValue.replace(/,/g, '');
    const match = normalized.match(/-?\d+(\.\d+)?/);

    if (!match) {
        return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function toIntegerOrNull(value) {
    const n = toNumberOrNull(value);
    if (n === null) {
        return null;
    }
    const i = Math.trunc(n);
    return Number.isFinite(i) ? i : null;
}

function toStringOrNull(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const text = String(value).trim();
    return text || null;
}

function headerMatches(header, pattern) {
    const h = String(header || '').toLowerCase().replace(/\s+/g, '_');
    return pattern.test(h);
}

function inferFromRawRow(columns, row) {
    const headers = (Array.isArray(columns) ? columns : []).map((c) => toStringOrNull(c)?.toLowerCase() || '');
    const values = Array.isArray(row) ? row : [];

    let fleetManagerId = null;
    let truckId = null;
    let truckNumber = null;
    let sourceLat = null;
    let sourceLng = null;
    let destLat = null;
    let destLng = null;
    let deadline = null;

    for (let index = 0; index < values.length; index += 1) {
        const header = headers[index] || '';
        const value = values[index];
        const h = header.replace(/[\s_]/g, ''); // strip all whitespace and underscores for aggressive matching

        // Fleet Manager ID
        if (fleetManagerId === null && (h.includes('fleetmanager') || h.includes('managerid') || h.includes('ownerid'))) {
            fleetManagerId = toIntegerOrNull(value);
        }
        // Truck ID
        if (truckId === null && (h.includes('truckid') || (h.includes('truck') && h.includes('id')))) {
            truckId = toIntegerOrNull(value);
        }
        // Truck Number / Ref
        if (truckNumber === null && (h.includes('trucknumber') || h.includes('truckref') || h.includes('truckno') || h.includes('truckreg') || h.includes('vehiclereg') || h.includes('truck#'))) {
            truckNumber = toStringOrNull(value);
        }
        // Source Lat
        if (sourceLat === null && ((h.includes('start') || h.includes('source') || h.includes('origin') || h.includes('pickup') || h.includes('from') || h.includes('src')) && (h.includes('lat') || h.includes('latitude')))) {
            sourceLat = toNumberOrNull(value);
        }
        // Source Lng
        if (sourceLng === null && ((h.includes('start') || h.includes('source') || h.includes('origin') || h.includes('pickup') || h.includes('from') || h.includes('src')) && (h.includes('lng') || h.includes('lon') || h.includes('long')))) {
            sourceLng = toNumberOrNull(value);
        }
        // Destination Lat
        if (destLat === null && ((h.includes('end') || h.includes('dest') || h.includes('destination') || h.includes('drop') || h.includes('delivery') || h.includes('to')) && (h.includes('lat') || h.includes('latitude')))) {
            destLat = toNumberOrNull(value);
        }
        // Destination Lng
        if (destLng === null && ((h.includes('end') || h.includes('dest') || h.includes('destination') || h.includes('drop') || h.includes('delivery') || h.includes('to')) && (h.includes('lng') || h.includes('lon') || h.includes('long')))) {
            destLng = toNumberOrNull(value);
        }
        // Deadline
        if (deadline === null && (h.includes('deadline') || h.includes('due') || h.includes('deliverydate') || h.includes('deliverytime') || h.includes('eta'))) {
            deadline = value;
        }
    }

    return {
        fleet_manager_id: fleetManagerId,
        truck_id: truckId,
        truck_number: truckNumber,
        source_lat: sourceLat,
        source_lng: sourceLng,
        dest_lat: destLat,
        dest_lng: destLng,
        deadline_timestamp: deadline,
    };
}

function normalizeDeadline(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }
    const s = toStringOrNull(value);
    return s;
}

function normalizeMappedRow(row) {
    const value = row && typeof row === 'object' ? row : {};

    return {
        fleet_manager_id: toIntegerOrNull(value.fleet_manager_id),
        truck_id: toIntegerOrNull(value.truck_id),
        truck_number: toStringOrNull(value.truck_number),
        source_lat: toNumberOrNull(value.source_lat),
        source_lng: toNumberOrNull(value.source_lng),
        dest_lat: toNumberOrNull(value.dest_lat),
        dest_lng: toNumberOrNull(value.dest_lng),
        deadline_timestamp: normalizeDeadline(value.deadline_timestamp),
    };
}

function mergeMappedWithFallback(mappedRow, columns, sourceRow) {
    const normalizedMapped = normalizeMappedRow(mappedRow);
    const fallback = inferFromRawRow(columns, sourceRow);

    return {
        fleet_manager_id: normalizedMapped.fleet_manager_id ?? fallback.fleet_manager_id,
        truck_id: normalizedMapped.truck_id ?? fallback.truck_id,
        truck_number: normalizedMapped.truck_number ?? fallback.truck_number,
        source_lat: normalizedMapped.source_lat ?? fallback.source_lat,
        source_lng: normalizedMapped.source_lng ?? fallback.source_lng,
        dest_lat: normalizedMapped.dest_lat ?? fallback.dest_lat,
        dest_lng: normalizedMapped.dest_lng ?? fallback.dest_lng,
        deadline_timestamp: normalizedMapped.deadline_timestamp ?? (fallback.deadline_timestamp != null ? normalizeDeadline(fallback.deadline_timestamp) : null),
    };
}

function buildPrompt({ sheetName, columns, rows }) {
    return [
        'Map spreadsheet rows to a trip payload schema used by a backend API.',
        'Return strict JSON only. No markdown or commentary.',
        'Output shape must be exactly: {"rows":[...]}',
        'Each row object must contain exactly these keys:',
        'fleet_manager_id, truck_id, truck_number, source_lat, source_lng, dest_lat, dest_lng, deadline_timestamp',
        'Rules:',
        '1) Keep the same row order as input.',
        '2) fleet_manager_id is integer or null; truck_id is integer or null.',
        '3) truck_number is string or null (fleet vehicle id / registration).',
        '3) source_lat, source_lng, dest_lat, dest_lng are decimal degrees (numbers) or null.',
        '4) deadline_timestamp is ISO-8601 string, Excel date serial converted to ISO if needed, or null.',
        '5) Do not invent coordinates; use null when unknown.',
        '6) Use header meaning, not exact header names, to map fields.',
        '7) Prefer truck_id from columns named truck id; otherwise map registration columns to truck_number.',
        '',
        `Sheet: ${sheetName}`,
        `Columns: ${JSON.stringify(columns)}`,
        `Rows: ${JSON.stringify(rows)}`,
    ].join('\n');
}

async function callGeminiForChunk({ apiKey, model, sheetName, columns, rows }) {
    const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const requestBody = {
        contents: [
            {
                role: 'user',
                parts: [{ text: buildPrompt({ sheetName, columns, rows }) }],
            },
        ],
        generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
        },
    };

    const geminiResponse = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    const geminiPayload = await geminiResponse.json().catch(() => null);

    if (!geminiResponse.ok) {
        const requestError = new Error(geminiPayload?.error?.message || 'Gemini request failed.');
        requestError.statusCode = 502;
        throw requestError;
    }

    const contentText = geminiPayload?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || '')
        .join('')
        .trim();

    if (!contentText) {
        const emptyResponseError = new Error('Gemini returned an empty response.');
        emptyResponseError.statusCode = 502;
        throw emptyResponseError;
    }

    const parsed = parseJsonFromGemini(contentText);
    const parsedRows = Array.isArray(parsed) ? parsed : parsed?.rows;

    if (!Array.isArray(parsedRows)) {
        const invalidResponseError = new Error('Gemini response format is invalid. Expected {"rows": [...]}.');
        invalidResponseError.statusCode = 502;
        throw invalidResponseError;
    }

    return parsedRows;
}

export async function mapExcelSheetsToTripFields(sheets) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.warn('GEMINI_API_KEY is not configured. Falling back to simple heuristic mapping.');
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const maxRowsPerBatch = Number(process.env.GEMINI_MAX_ROWS_PER_BATCH || DEFAULT_BATCH_SIZE);
    const safeBatchSize = Number.isFinite(maxRowsPerBatch) && maxRowsPerBatch > 0 ? maxRowsPerBatch : DEFAULT_BATCH_SIZE;

    const mappedRows = [];

    for (const sheet of sheets) {
        const sheetName = sheet?.sheetName || 'Sheet';
        const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
        const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];

        if (!rows.length) {
            continue;
        }

        if (apiKey) {
            try {
                for (let offset = 0; offset < rows.length; offset += safeBatchSize) {
                    const rowChunk = rows.slice(offset, offset + safeBatchSize);
                    const mappedChunk = await callGeminiForChunk({
                        apiKey,
                        model,
                        sheetName,
                        columns,
                        rows: rowChunk,
                    });

                    for (let rowIndex = 0; rowIndex < rowChunk.length; rowIndex += 1) {
                        const sourceRow = rowChunk[rowIndex];
                        const mappedRow = mappedChunk[rowIndex] || {};
                        mappedRows.push(mergeMappedWithFallback(mappedRow, columns, sourceRow));
                    }
                }
            } catch (error) {
                for (const row of rows) {
                    mappedRows.push(inferFromRawRow(columns, row));
                }
            }
        } else {
            for (const row of rows) {
                mappedRows.push(inferFromRawRow(columns, row));
            }
        }
    }

    return mappedRows;
}
