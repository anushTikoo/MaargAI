const TRUCK_DEFAULTS = {
    mini: { capacity: 1000, height: 2.0, mileage: 18 },
    light: { capacity: 4000, height: 2.5, mileage: 10 },
    medium: { capacity: 10000, height: 3.0, mileage: 6 },
    heavy: { capacity: 25000, height: 3.5, mileage: 4 },
    trailer: { capacity: 45000, height: 4.0, mileage: 3 },
};

function inferCategory(capacity) {
    if (capacity <= 2000) return 'mini';
    if (capacity <= 7000) return 'light';
    if (capacity <= 16000) return 'medium';
    if (capacity <= 40000) return 'heavy';
    return 'trailer';
}

function createTruckError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function toNullableString(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const text = String(value).trim();
    return text || null;
}

function toNullableNumber(value) {
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

    const parsed = Number.parseFloat(rawValue.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function buildTruckPayload(input = {}) {
    const fleetManagerId = toNullableString(input.fleet_manager_id);
    const truckNumber = toNullableString(input.truck_number);

    if (!fleetManagerId || !truckNumber) {
        throw createTruckError('fleet_manager_id and truck_number are required.');
    }

    const truckType = toNullableString(input.truck_type)?.toLowerCase() || null;
    const capacityKg = toNullableNumber(input.capacity_kg);

    if (!truckType && capacityKg === null) {
        throw createTruckError('At least one of truck_type or capacity_kg is required.');
    }

    let finalType = truckType;
    let finalCapacity = capacityKg;

    if (finalCapacity !== null) {
        finalType = inferCategory(finalCapacity);
    } else if (finalType) {
        if (!TRUCK_DEFAULTS[finalType]) {
            throw createTruckError('Invalid truck_type provided.');
        }

        finalCapacity = TRUCK_DEFAULTS[finalType].capacity;
    }

    const defaults = TRUCK_DEFAULTS[finalType];

    if (!defaults) {
        throw createTruckError('Invalid truck specifications could not be resolved.');
    }

    const finalHeight = toNullableNumber(input.height_m) ?? defaults.height;
    const finalMileage = toNullableNumber(input.mileage_kmpl) ?? defaults.mileage;
    const finalWeight = toNullableNumber(input.truck_weight) ?? Math.round(finalCapacity * 1.5);

    const isCustom = Boolean(
        input.height_m ||
        input.mileage_kmpl ||
        input.truck_weight ||
        (input.capacity_kg && Number.parseFloat(input.capacity_kg) !== defaults.capacity)
    );

    if (!Number.isFinite(finalCapacity) || finalCapacity <= 0) {
        throw createTruckError('capacity_kg must be > 0');
    }

    if (!Number.isFinite(finalHeight) || finalHeight < 1.5 || finalHeight > 5.0) {
        throw createTruckError('height_m must be between 1.5 and 5.0');
    }

    if (!Number.isFinite(finalMileage) || finalMileage <= 0) {
        throw createTruckError('mileage_kmpl must be > 0');
    }

    if (!Number.isFinite(finalWeight) || finalWeight <= 0) {
        throw createTruckError('truck_weight must be > 0');
    }

    return {
        fleet_manager_id: fleetManagerId,
        truck_number: truckNumber,
        truck_type: finalType,
        capacity_kg: finalCapacity,
        height_m: finalHeight,
        mileage_kmpl: finalMileage,
        truck_weight: finalWeight,
        is_custom: isCustom,
    };
}

export async function insertTruckRecord(client, input) {
    const payload = buildTruckPayload(input);

    try {
        const result = await client.query(
            `INSERT INTO trucks (
                fleet_manager_id, truck_number, truck_type, capacity_kg, height_m, mileage_kmpl, truck_weight, is_custom
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                payload.fleet_manager_id,
                payload.truck_number,
                payload.truck_type,
                payload.capacity_kg,
                payload.height_m,
                payload.mileage_kmpl,
                payload.truck_weight,
                payload.is_custom,
            ]
        );

        return result.rows[0];
    } catch (error) {
        if (error.code === '23505') {
            throw createTruckError('Truck with this number already exists.', 409);
        }

        if (error.code === '23503') {
            throw createTruckError('Invalid fleet_manager_id. User does not exist.');
        }

        throw error;
    }
}

export { TRUCK_DEFAULTS, inferCategory, buildTruckPayload };