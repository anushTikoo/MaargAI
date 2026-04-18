import {
    getAuthTokenFromRequest,
    serializeClearAuthCookie,
    verifyAuthToken,
} from '../utils/authSession.js';

export default function requireAuth(request, response, next) {
    const token = getAuthTokenFromRequest(request);

    if (!token) {
        response.setHeader('Set-Cookie', serializeClearAuthCookie());
        return response.status(401).json({ error: 'Unauthorized.' });
    }

    const payload = verifyAuthToken(token);

    if (!payload?.sub) {
        response.setHeader('Set-Cookie', serializeClearAuthCookie());
        return response.status(401).json({ error: 'Unauthorized.' });
    }

    request.auth = payload;
    return next();
}