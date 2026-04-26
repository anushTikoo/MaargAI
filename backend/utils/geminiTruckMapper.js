const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_BATCH_SIZE = 80;

function inferCategory(capacityKg) {
    if (capacityKg <= 2000) return 'mini';
    if (capacityKg <= 7000) return 'light';
    if (capacityKg <= 16000) return 'medium';
    if (capacityKg <= 40000) return 'heavy';
    return 'trailer';
}

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

    let parsed = Number(match[0]);

    if (!Number.isFinite(parsed)) {
        return null;
    }

    const lowerValue = normalized.toLowerCase();

    if (!lowerValue.includes('kg') && /(ton|tons|tonne|tonnes|\bt\b)/.test(lowerValue)) {
        parsed *= 1000;
    }

    return parsed;
}

function toStringOrNull(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const text = String(value).trim();
    return text || null;
}

function normalizeTruckType(value) {
    const normalized = toStringOrNull(value)?.toLowerCase();

    if (!normalized) {
        return null;
    }

    if (normalized.includes('trailer') || normalized.includes('semi')) return 'trailer';
    if (normalized.includes('heavy') || normalized.includes('hcv')) return 'heavy';
    if (normalized.includes('medium') || normalized.includes('mcv')) return 'medium';
    if (normalized.includes('light') || normalized.includes('lcv')) return 'light';
    if (normalized.includes('mini') || normalized.includes('small') || normalized.includes('pickup')) return 'mini';

    if (['mini', 'light', 'medium', 'heavy', 'trailer'].includes(normalized)) {
        return normalized;
    }

    if (/(kg|kgs|kilogram|ton|tons|tonne|tonnes|\d+\s*t\b|\d+t\b)/.test(normalized)) {
        const inferredCapacity = toNumberOrNull(normalized);

        if (inferredCapacity !== null) {
            return inferCategory(inferredCapacity);
        }
    }

    return null;
}

function hasCapacityHintInHeader(headerName = '') {
    return /(capacity|payload|load|ton|tonne|weight|gvw|kg)/.test(headerName);
}

function hasTypeHintInHeader(headerName = '') {
    return /(truck.?type|vehicle.?type|type|category|class|segment|notes?|remarks?|comments?|description|details)/.test(headerName);
}

function inferCapacityFromCell(cellValue, headerName = '') {
    const text = toStringOrNull(cellValue);

    if (!text) {
        return null;
    }

    const normalizedHeader = String(headerName || '').toLowerCase();
    const lowerText = text.toLowerCase();
    const headerHasCapacityHint = hasCapacityHintInHeader(normalizedHeader);
    const hasExplicitUnit = /(kg|kgs|kilogram|ton|tons|tonne|tonnes|\d+\s*t\b|\d+t\b)/.test(lowerText);

    if (!headerHasCapacityHint && !hasExplicitUnit) {
        return null;
    }

    let parsed = toNumberOrNull(text);

    if (parsed === null) {
        return null;
    }

    if (!hasExplicitUnit && /(ton|tonne|\bt\b)/.test(normalizedHeader) && !/(kg|kgs|kilogram)/.test(lowerText)) {
        parsed *= 1000;
    }

    return parsed;
}

function inferFromRawRow(columns, row) {
    const headers = (Array.isArray(columns) ? columns : []).map((column) => toStringOrNull(column)?.toLowerCase() || '');
    const values = Array.isArray(row) ? row : [];

    let fallbackType = null;
    let fallbackCapacity = null;

    for (let index = 0; index < values.length; index += 1) {
        const header = headers[index] || '';
        const value = values[index];

        if (fallbackType === null && hasTypeHintInHeader(header)) {
            fallbackType = normalizeTruckType(value);
        }

        if (fallbackCapacity === null && hasCapacityHintInHeader(header)) {
            fallbackCapacity = inferCapacityFromCell(value, header);
        }

        if (fallbackType !== null && fallbackCapacity !== null) {
            break;
        }
    }

    if (fallbackType === null || fallbackCapacity === null) {
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index];

            if (fallbackType === null) {
                fallbackType = normalizeTruckType(value);
            }

            if (fallbackCapacity === null) {
                const explicitCapacity = inferCapacityFromCell(value);
                fallbackCapacity = explicitCapacity;
            }

            if (fallbackType !== null && fallbackCapacity !== null) {
                break;
            }
        }
    }

    if (fallbackType === null && fallbackCapacity !== null) {
        fallbackType = inferCategory(fallbackCapacity);
    }

    return {
        truck_type: fallbackType,
        capacity_kg: fallbackCapacity,
    };
}

function mergeMappedWithFallback(mappedRow, columns, sourceRow) {
    const normalizedMapped = normalizeMappedRow(mappedRow);
    const fallback = inferFromRawRow(columns, sourceRow);

    const capacityKg = normalizedMapped.capacity_kg ?? fallback.capacity_kg;
    const truckType = normalizedMapped.truck_type ?? fallback.truck_type ?? (capacityKg !== null ? inferCategory(capacityKg) : null);

    return {
        ...normalizedMapped,
        truck_type: truckType,
        capacity_kg: capacityKg,
    };
}

function normalizeMappedRow(row) {
    const value = row && typeof row === 'object' ? row : {};

    return {
        truck_number: toStringOrNull(value.truck_number),
        truck_type: normalizeTruckType(value.truck_type),
        capacity_kg: toNumberOrNull(value.capacity_kg),
        height_m: toNumberOrNull(value.height_m),
        mileage_kmpl: toNumberOrNull(value.mileage_kmpl),
        truck_weight: toNumberOrNull(value.truck_weight),
    };
}

function buildPrompt({ sheetName, columns, rows }) {
    return [
        'Map spreadsheet rows to a truck payload schema used by a backend API.',
        'Return strict JSON only. No markdown or commentary.',
        'Output shape must be exactly: {"rows":[...]}',
        'Each row object must contain exactly these keys:',
        'truck_number, truck_type, capacity_kg, height_m, mileage_kmpl, truck_weight',
        'Rules:',
        '1) Keep the same row order as input.',
        '2) truck_number is string or null.',
        '3) truck_type must be one of mini/light/medium/heavy/trailer or null.',
        '4) Numeric fields must be numbers or null (strip units if present).',
        '5) Do not invent missing values; use null when unknown.',
        '6) Use header meaning, not exact header names, to map fields.',
        '7) Important: infer truck_type and/or capacity_kg from notes/remarks/comments/description columns when possible.',
        '8) If a row mentions tonnage like "7T", "14 ton" or "16 tonnes", convert it to capacity_kg and infer truck_type.',
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

export async function mapExcelSheetsToTruckFields(sheets) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        const missingKeyError = new Error('GEMINI_API_KEY is not configured in backend/.env.');
        missingKeyError.statusCode = 500;
        throw missingKeyError;
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
    }

    return mappedRows;
}
