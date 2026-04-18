import { cacheAuthSession, fetchCurrentUser, getAuthSession } from './authService';

const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

function getAuthHeaders() {
    const token = getAuthSession()?.token;

    if (!token) {
        return {};
    }

    return {
        Authorization: `Bearer ${token}`,
    };
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

    return data.truck;
}

export async function getTrucksForCurrentUser() {
    const userId = await resolveCurrentUserId();

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

    return true;
}