import { fetchCurrentUser, getAuthSession } from './authService';

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

function parseTokenPayload(token) {
    if (!token || typeof token !== 'string') {
        return null;
    }

    const [payloadPart] = token.split('.');

    if (!payloadPart) {
        return null;
    }

    try {
        const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        return JSON.parse(window.atob(padded));
    } catch {
        return null;
    }
}

function getFleetManagerIdFromSession() {
    const session = getAuthSession();

    if (session?.user?.id !== undefined && session?.user?.id !== null) {
        return String(session.user.id);
    }

    const tokenPayload = parseTokenPayload(session?.token);

    if (tokenPayload?.sub !== undefined && tokenPayload?.sub !== null) {
        return String(tokenPayload.sub);
    }

    return null;
}

async function resolveFleetManagerId() {
    const sessionId = getFleetManagerIdFromSession();

    if (sessionId) {
        return sessionId;
    }

    const currentUser = await fetchCurrentUser();

    if (currentUser?.id !== undefined && currentUser?.id !== null) {
        return String(currentUser.id);
    }

    throw new Error('Unable to identify the signed-in user. Please sign in again.');
}

export async function uploadFleetExcelFile(file) {
    if (!file) {
        throw new Error('Select an Excel file before uploading.');
    }

    const fleetManagerId = await resolveFleetManagerId();
    const formData = new FormData();

    formData.append('file', file);
    formData.append('fleet_manager_id', fleetManagerId);

    const response = await fetch(`${apiBaseUrl}/api/fleet/excel-to-json`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
        body: formData,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || 'Unable to upload fleet file.');
    }

    return data;
}