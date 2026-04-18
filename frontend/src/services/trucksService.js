import { cacheAuthSession, fetchCurrentUser, getAuthSession } from './authService';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
const trucksCachePrefix = 'maargai_trucks_user_';

function getAuthHeaders() {
    const token = getAuthSession()?.token;

    if (!token) {
        return {};
    }

    return {
        Authorization: `Bearer ${token}`,
    };
}

function getUserTrucksCacheKey(userId) {
    return `${trucksCachePrefix}${userId}`;
}

function parseJson(rawValue) {
    try {
        return JSON.parse(rawValue);
    } catch {
        return null;
    }
}

function normalizeCachedTrucks(parsedValue) {
    if (Array.isArray(parsedValue)) {
        return parsedValue;
    }

    if (parsedValue && Array.isArray(parsedValue.trucks)) {
        return parsedValue.trucks;
    }

    return null;
}

function readTrucksFromCache(userId) {
    const rawCache = window.localStorage.getItem(getUserTrucksCacheKey(userId));

    if (!rawCache) {
        return null;
    }

    const parsedCache = parseJson(rawCache);
    return normalizeCachedTrucks(parsedCache);
}

function writeTrucksToCache(userId, trucks) {
    window.localStorage.setItem(
        getUserTrucksCacheKey(userId),
        JSON.stringify({
            trucks,
            cachedAt: Date.now(),
        })
    );
}

function upsertTruckInCache(userId, truck) {
    const cachedTrucks = readTrucksFromCache(userId) ?? [];
    const deduplicated = cachedTrucks.filter(
        (cachedTruck) => cachedTruck.id !== truck.id && cachedTruck.truck_number !== truck.truck_number
    );

    writeTrucksToCache(userId, [truck, ...deduplicated]);
}

function removeTruckFromCache(userId, truckId) {
    const cachedTrucks = readTrucksFromCache(userId) ?? [];
    const filtered = cachedTrucks.filter((cachedTruck) => String(cachedTruck.id) !== String(truckId));
    writeTrucksToCache(userId, filtered);
}

async function resolveCurrentUserId() {
    const existingSession = getAuthSession();

    if (existingSession?.user?.id) {
        return existingSession.user.id;
    }

    const user = await fetchCurrentUser();

    if (user?.id) {
        if (existingSession?.token) {
            cacheAuthSession({ token: existingSession.token, user });
        }

        return user.id;
    }

    throw new Error('Unable to identify the signed-in user. Please sign in again.');
}

export async function addTruckForCurrentUser({ truckNumber, truckType, advancedSpecs }) {
    const userId = await resolveCurrentUserId();
    const requestBody = {
        fleet_manager_id: userId,
        truck_number: truckNumber,
        truck_type: truckType.toLowerCase(),
    };

    if (advancedSpecs) {
        requestBody.capacity_kg = Number(advancedSpecs.capacity);
        requestBody.height_m = Number(advancedSpecs.height);
        requestBody.mileage_kmpl = Number(advancedSpecs.mileage);
        requestBody.truck_weight = Number(advancedSpecs.weight);
    }

    const response = await fetch(`${apiBaseUrl}/api/trucks`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(requestBody),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to add truck to fleet.');
    }

    if (!data?.truck) {
        throw new Error('Truck was added but response was invalid.');
    }

    upsertTruckInCache(userId, data.truck);
    return data.truck;
}

export async function getTrucksForCurrentUser() {
    const userId = await resolveCurrentUserId();
    const cachedTrucks = readTrucksFromCache(userId);

    if (cachedTrucks !== null) {
        return { trucks: cachedTrucks, source: 'local-storage' };
    }

    const response = await fetch(`${apiBaseUrl}/api/trucks?fleet_manager_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to load trucks.');
    }

    const trucks = Array.isArray(data) ? data : [];
    writeTrucksToCache(userId, trucks);

    return { trucks, source: 'database' };
}

export async function updateTruckForCurrentUser(truckId, { truckNumber, truckType, advancedSpecs }) {
    const userId = await resolveCurrentUserId();
    const requestBody = {
        fleet_manager_id: userId,
        truck_number: truckNumber,
        truck_type: truckType.toLowerCase(),
    };

    if (advancedSpecs) {
        if (advancedSpecs.capacity) requestBody.capacity_kg = Number(advancedSpecs.capacity);
        if (advancedSpecs.height) requestBody.height_m = Number(advancedSpecs.height);
        if (advancedSpecs.mileage) requestBody.mileage_kmpl = Number(advancedSpecs.mileage);
        if (advancedSpecs.weight) requestBody.truck_weight = Number(advancedSpecs.weight);
    }

    const response = await fetch(`${apiBaseUrl}/api/trucks/${encodeURIComponent(truckId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(requestBody),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to update truck.');
    }

    if (!data?.truck) {
        throw new Error('Truck was updated but response was invalid.');
    }

    upsertTruckInCache(userId, data.truck);
    return data.truck;
}

export async function deleteTruckForCurrentUser(truckId) {
    const userId = await resolveCurrentUserId();
    const response = await fetch(`${apiBaseUrl}/api/trucks/${encodeURIComponent(truckId)}?fleet_manager_id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to delete truck.');
    }

    removeTruckFromCache(userId, truckId);
    return true;
}