import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { cacheAuthSession, exchangeGoogleHandoff, fetchCurrentUser, getAuthSession } from '../services/authService';

export default function ProtectedRoute() {
    const location = useLocation();
    const [isChecking, setIsChecking] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const handoffCode = new URLSearchParams(location.search).get('handoff');

    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;

        const verifyAccess = async () => {
            try {
                if (handoffCode) {
                    const exchangedSession = await exchangeGoogleHandoff(handoffCode, controller.signal);

                    if (!isActive || controller.signal.aborted) {
                        return;
                    }

                    if (exchangedSession?.user) {
                        cacheAuthSession(exchangedSession);
                        setIsAuthorized(true);
                        return;
                    }
                }

                const existingSession = getAuthSession();

                if (existingSession?.token) {
                    if (!isActive || controller.signal.aborted) {
                        return;
                    }

                    setIsAuthorized(true);
                    return;
                }

                const user = await fetchCurrentUser(controller.signal);

                if (!isActive || controller.signal.aborted) {
                    return;
                }

                setIsAuthorized(Boolean(user));
            } catch (error) {
                if (!isActive || controller.signal.aborted || error?.name === 'AbortError') {
                    return;
                }

                setIsAuthorized(false);
            } finally {
                if (isActive && !controller.signal.aborted) {
                    setIsChecking(false);
                }
            }
        };

        verifyAccess();

        return () => {
            isActive = false;
            controller.abort();
        };
    }, [handoffCode]);

    if (isChecking) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface text-on-surface px-6 text-center">
                <div>
                    <div className="text-sm uppercase tracking-[0.2em] text-secondary mb-3">MaargAI</div>
                    <div className="text-2xl font-black tracking-tight">Checking access...</div>
                </div>
            </div>
        );
    }

    if (!isAuthorized) {
        return <Navigate replace state={{ from: location }} to="/signup?mode=signin" />;
    }

    return <Outlet />;
}