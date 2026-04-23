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

export async function getTripsForCurrentUser() {
    const userId = await resolveCurrentUserId();

    const response = await fetch(`${apiBaseUrl}/api/trips?fleet_manager_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to load trips.');
    }

    return {
        trips: Array.isArray(data?.trips) ? data.trips : [],
        source: 'database',
    };
}

export async function createTripForCurrentUser({ truckId, source, destination, sourceLat, sourceLng, destLat, destLng, deadlineTimestamp }) {
    const userId = await resolveCurrentUserId();

    const requestBody = {
        fleet_manager_id: Number(userId),
        truck_id: Number(truckId),
        source: String(source || '').trim(),
        destination: String(destination || '').trim(),
        source_lat: Number(sourceLat),
        source_lng: Number(sourceLng),
        dest_lat: Number(destLat),
        dest_lng: Number(destLng),
    };

    if (deadlineTimestamp) {
        requestBody.deadline_timestamp = deadlineTimestamp;
    }

    const response = await fetch(`${apiBaseUrl}/api/trips/create-trip`, {
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
        throw new Error(data?.error || 'Unable to create trip.');
    }

    return data;
}

export async function deleteTripForCurrentUser(tripId) {
    const userId = await resolveCurrentUserId();

    const response = await fetch(`${apiBaseUrl}/api/trips/${encodeURIComponent(tripId)}?fleet_manager_id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to delete trip.');
    }

    return data;
}
