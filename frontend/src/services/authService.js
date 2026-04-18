const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const authSessionKey = 'maargai_auth_session';

function getSessionStorage() {
    return window.localStorage;
}

export function cacheAuthSession(session) {
    if (!session?.token) {
        return;
    }

    const serializedSession = JSON.stringify({
        token: session.token,
        user: session.user ?? null,
    });

    getSessionStorage().setItem(authSessionKey, serializedSession);
    window.sessionStorage.setItem(authSessionKey, serializedSession);
}

export function getAuthSession() {
    const rawSession = getSessionStorage().getItem(authSessionKey) || window.sessionStorage.getItem(authSessionKey);

    if (!rawSession) {
        return null;
    }

    try {
        return JSON.parse(rawSession);
    } catch {
        return null;
    }
}

export function clearAuthSession() {
    getSessionStorage().removeItem(authSessionKey);
    window.sessionStorage.removeItem(authSessionKey);
}

function getAuthHeaders() {
    const session = getAuthSession();

    if (!session?.token) {
        return {};
    }

    return {
        Authorization: `Bearer ${session.token}`,
    };
}

export async function fetchCurrentUser(signal) {
    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
        signal,
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    return data?.user ?? getAuthSession()?.user ?? null;
}

export async function exchangeGoogleHandoff(code, signal) {
    const response = await fetch(`${apiBaseUrl}/api/auth/google/exchange`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        signal,
        body: JSON.stringify({ code }),
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    return data ?? null;
}

export async function logout() {
    clearAuthSession();

    await fetch(`${apiBaseUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
        },
    });
}