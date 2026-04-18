import crypto from 'crypto';

const HANDOFF_TTL_MS = 5 * 60 * 1000;
const handoffStore = new Map();

function cleanupExpiredHandoffs() {
    const now = Date.now();

    for (const [code, entry] of handoffStore.entries()) {
        if (entry.expiresAt <= now) {
            handoffStore.delete(code);
        }
    }
}

export function createAuthHandoff(user) {
    cleanupExpiredHandoffs();

    const code = crypto.randomBytes(32).toString('base64url');

    handoffStore.set(code, {
        user: {
            id: user.id,
            email: user.email,
        },
        expiresAt: Date.now() + HANDOFF_TTL_MS,
    });

    return code;
}

export function consumeAuthHandoff(code) {
    cleanupExpiredHandoffs();

    const entry = handoffStore.get(code);

    if (!entry) {
        return null;
    }

    return entry.user;
}