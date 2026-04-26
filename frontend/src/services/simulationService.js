const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL}/api` : `${window.location.protocol}//${window.location.hostname}:3000/api`;

export async function injectDelay(tripId, delayMinutes) {
    const response = await fetch(`${API_BASE_URL}/simulation/inject-delay`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trip_id: tripId, delay_minutes: delayMinutes }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to inject delay.');
    }

    return response.json();
}

export async function resetSimulation(tripId) {
    const response = await fetch(`${API_BASE_URL}/simulation/reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trip_id: tripId }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to reset simulation.');
    }

    return response.json();
}

export async function processActiveTripsWorker() {
    const response = await fetch(`${API_BASE_URL}/worker/process-active-trips`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to trigger worker.');
    }

    return response.json();
}
