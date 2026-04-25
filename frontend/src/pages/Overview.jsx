import { useEffect, useRef, useState } from 'react';
import { getActiveMapTripsForCurrentUser } from '../services/tripsService';

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 5;
const ACTIVE_TRIP_REFRESH_MS = 5000;
const ROUTE_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

function isValidCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function formatCoordinate(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return 'N/A';
    }

    return numericValue.toFixed(5);
}

function formatDuration(value) {
    const totalSeconds = Number(value);

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return 'N/A';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${Math.max(1, minutes)}m`;
}

function formatDistanceMeters(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return 'N/A';
    }

    if (numericValue >= 1000) {
        return `${(numericValue / 1000).toFixed(1)} km`;
    }

    return `${Math.round(numericValue)} m`;
}

function formatTimestamp(value) {
    const timestamp = Number(value);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return 'Unknown';
    }

    return new Date(timestamp).toLocaleString();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function decodePolyline(encodedPolyline) {
    if (typeof encodedPolyline !== 'string' || encodedPolyline.length === 0) {
        return [];
    }

    const path = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encodedPolyline.length) {
        let shift = 0;
        let result = 0;
        let byte;

        do {
            if (index >= encodedPolyline.length) {
                return path;
            }

            byte = encodedPolyline.charCodeAt(index) - 63;
            index += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const latitudeChange = result & 1 ? ~(result >> 1) : result >> 1;
        latitude += latitudeChange;

        shift = 0;
        result = 0;

        do {
            if (index >= encodedPolyline.length) {
                return path;
            }

            byte = encodedPolyline.charCodeAt(index) - 63;
            index += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const longitudeChange = result & 1 ? ~(result >> 1) : result >> 1;
        longitude += longitudeChange;

        path.push({
            lat: latitude / 1e5,
            lng: longitude / 1e5,
        });
    }

    return path;
}

function createTruckMarkerElement() {
    const el = document.createElement('div');
    el.style.cssText = 'width:36px;height:36px;cursor:pointer;';
    el.innerHTML = `<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="17" fill="#1f2937"/><path d="M8 12h14v7h3l3 3v3h-2a3 3 0 0 1-6 0h-4a3 3 0 0 1-6 0H8v-13zm18 2v5h-4v-5h4z" fill="#f9fafb"/></svg>`;
    return el;
}

function createPointMarkerElement(color) {
    const el = document.createElement('div');
    el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;`;
    return el;
}

function clearTripLayer(layer) {
    if (!layer) {
        return;
    }

    if (Array.isArray(layer.routeListeners)) {
        layer.routeListeners.forEach((listener) => listener.remove());
    }

    if (Array.isArray(layer.truckListeners)) {
        layer.truckListeners.forEach((listener) => listener.remove());
    }

    if (layer.sourceMarker) {
        layer.sourceMarker.map = null;
    }

    if (layer.destinationMarker) {
        layer.destinationMarker.map = null;
    }

    if (layer.routePolyline) {
        layer.routePolyline.setMap(null);
    }

    if (layer.routeHitArea) {
        layer.routeHitArea.setMap(null);
    }

    if (layer.truckMarker) {
        layer.truckMarker.map = null;
    }
}

function buildTripInfoHtml(trip) {
    const truckLabel = trip.truck_number || `#${trip.truck_id}`;
    const sourceLabel = trip.source || `${formatCoordinate(trip.source_lat)}, ${formatCoordinate(trip.source_lng)}`;
    const destinationLabel = trip.destination || `${formatCoordinate(trip.dest_lat)}, ${formatCoordinate(trip.dest_lng)}`;

    return `
        <div style="min-width: 220px; font-family: 'Inter', sans-serif; padding: 4px; color: #1a1c1e;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
                <div style="background: #aa3000; color: white; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                    <span style="font-family: 'Material Symbols Outlined'; font-size: 18px;">local_shipping</span>
                </div>
                <div style="font-size: 14px; font-weight: 800; letter-spacing: -0.01em;">Truck ${escapeHtml(truckLabel)}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="font-size: 11px; line-height: 1.4;">
                    <span style="color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; display: block; margin-bottom: 1px;">From</span>
                    <span style="font-weight: 500;">${escapeHtml(sourceLabel)}</span>
                </div>
                <div style="font-size: 11px; line-height: 1.4;">
                    <span style="color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; display: block; margin-bottom: 1px;">To</span>
                    <span style="font-weight: 500;">${escapeHtml(destinationLabel)}</span>
                </div>
                <div style="margin-top: 4px; padding-top: 8px; border-top: 1px dashed #eee; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 11px; font-weight: 700; color: #aa3000;">
                        ${escapeHtml(formatDistanceMeters(trip?.route?.distance_meters))}
                    </div>
                    <div style="font-size: 11px; font-weight: 500; color: #6b7280;">
                        ${escapeHtml(formatDuration(trip?.route?.duration_seconds))}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function buildTruckInfoHtml(trip, location) {
    const truckLabel = trip.truck_number || `#${trip.truck_id}`;

    return `
        <div style="min-width: 200px; font-family: 'Inter', sans-serif; padding: 4px; color: #1a1c1e;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                <div style="background: #1f2937; color: white; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                    <span style="font-family: 'Material Symbols Outlined'; font-size: 18px;">monitoring</span>
                </div>
                <div>
                    <div style="font-size: 13px; font-weight: 800; letter-spacing: -0.01em;">Truck ${escapeHtml(truckLabel)}</div>
                    <div style="font-size: 10px; color: #059669; font-weight: 600; display: flex; align-items: center; gap: 3px;">
                        <span style="width: 6px; height: 6px; background: #059669; border-radius: 50%; display: inline-block;"></span> Live Tracking
                    </div>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 11px; line-height: 1.4;">
                    <span style="color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; display: block; margin-bottom: 2px;">Last Known Location</span>
                    <span style="font-weight: 500;">${escapeHtml(formatCoordinate(location.lat))}, ${escapeHtml(formatCoordinate(location.lng))}</span>
                </div>
                <div style="font-size: 10px; color: #6b7280; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                    <span style="font-family: 'Material Symbols Outlined'; font-size: 12px;">schedule</span>
                    Updated ${escapeHtml(formatTimestamp(location.timestamp))}
                </div>
            </div>
        </div>
    `;
}

export default function Overview() {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const tripLayersRef = useRef(new Map());
    const tripInfoWindowRef = useRef(null);
    const truckInfoWindowRef = useRef(null);
    const currentBoundsRef = useRef(null);

    const [activeTrips, setActiveTrips] = useState([]);
    const [mapError, setMapError] = useState('');
    const [isMapReady, setIsMapReady] = useState(false);
    const [hasInitialFit, setHasInitialFit] = useState(false);

    useEffect(() => {
        let isDisposed = false;
        let retryTimerId;
        const tripLayers = tripLayersRef.current;

        const initializeMap = () => {
            if (isDisposed || !mapRef.current || mapInstanceRef.current) {
                return;
            }

            if (!window.google?.maps?.Map) {
                retryTimerId = window.setTimeout(initializeMap, 200);
                return;
            }

            mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
                center: DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                mapId: 'DEMO_MAP_ID',
                disableDefaultUI: true,
                zoomControl: true,
            });

            tripInfoWindowRef.current = new window.google.maps.InfoWindow();
            truckInfoWindowRef.current = new window.google.maps.InfoWindow();
            setIsMapReady(true);
        };

        initializeMap();

        return () => {
            isDisposed = true;

            if (retryTimerId) {
                window.clearTimeout(retryTimerId);
            }

            tripInfoWindowRef.current?.close();
            truckInfoWindowRef.current?.close();

            tripLayers.forEach((layer) => clearTripLayer(layer));
            tripLayers.clear();

            mapInstanceRef.current = null;
            setIsMapReady(false);
        };
    }, []);

    useEffect(() => {
        let ignoreResult = false;
        let refreshIntervalId;

        const loadActiveTripsMapData = async () => {
            try {
                const { trips } = await getActiveMapTripsForCurrentUser();

                if (ignoreResult) {
                    return;
                }

                setActiveTrips(Array.isArray(trips) ? trips : []);
                setMapError('');
            } catch (error) {
                if (ignoreResult) {
                    return;
                }

                setMapError(error?.message || 'Unable to load active trips map data.');
            }
        };

        loadActiveTripsMapData();
        refreshIntervalId = window.setInterval(loadActiveTripsMapData, ACTIVE_TRIP_REFRESH_MS);

        return () => {
            ignoreResult = true;

            if (refreshIntervalId) {
                window.clearInterval(refreshIntervalId);
            }
        };
    }, []);

    useEffect(() => {
        const map = mapInstanceRef.current;

        if (!isMapReady || !map || !window.google?.maps) {
            return;
        }

        tripInfoWindowRef.current?.close();
        truckInfoWindowRef.current?.close();

        tripLayersRef.current.forEach((layer) => clearTripLayer(layer));
        tripLayersRef.current.clear();

        const tripsWithLiveLocations = activeTrips.filter((trip) => {
            const location = trip?.live_location;
            return isValidCoordinate(Number(location?.lat), Number(location?.lng));
        });

        if (tripsWithLiveLocations.length === 0) {
            map.setCenter(DEFAULT_CENTER);
            map.setZoom(DEFAULT_ZOOM);
            return;
        }

        const bounds = new window.google.maps.LatLngBounds();

        tripsWithLiveLocations.forEach((trip, index) => {
            const sourceLat = Number(trip.source_lat);
            const sourceLng = Number(trip.source_lng);
            const destinationLat = Number(trip.dest_lat);
            const destinationLng = Number(trip.dest_lng);
            const liveLocation = trip.live_location;
            const routeColor = ROUTE_COLORS[index % ROUTE_COLORS.length];
            const sourcePosition = { lat: sourceLat, lng: sourceLng };
            const destinationPosition = { lat: destinationLat, lng: destinationLng };
            const truckPosition = { lat: Number(liveLocation.lat), lng: Number(liveLocation.lng) };
            const routePath = decodePolyline(trip?.route?.polyline);

            const { AdvancedMarkerElement } = window.google.maps.marker;

            const sourceMarker = isValidCoordinate(sourceLat, sourceLng)
                ? new AdvancedMarkerElement({
                    map,
                    position: sourcePosition,
                    title: `Source (${sourceLat.toFixed(5)}, ${sourceLng.toFixed(5)})`,
                    content: createPointMarkerElement('#059669'),
                    zIndex: 400,
                })
                : null;

            const destinationMarker = isValidCoordinate(destinationLat, destinationLng)
                ? new AdvancedMarkerElement({
                    map,
                    position: destinationPosition,
                    title: `Destination (${destinationLat.toFixed(5)}, ${destinationLng.toFixed(5)})`,
                    content: createPointMarkerElement('#dc2626'),
                    zIndex: 400,
                })
                : null;

            const routePolyline = routePath.length >= 2
                ? new window.google.maps.Polyline({
                    map,
                    path: routePath,
                    geodesic: true,
                    strokeColor: routeColor,
                    strokeOpacity: 0.9,
                    strokeWeight: 4,
                    zIndex: 300,
                })
                : null;

            const routeHitArea = routePath.length >= 2
                ? new window.google.maps.Polyline({
                    map,
                    path: routePath,
                    geodesic: true,
                    strokeColor: 'transparent',
                    strokeOpacity: 0,
                    strokeWeight: 20,
                    zIndex: 301,
                })
                : null;

            const truckMarker = new AdvancedMarkerElement({
                map,
                position: truckPosition,
                title: `Truck (${formatCoordinate(truckPosition.lat)}, ${formatCoordinate(truckPosition.lng)})`,
                content: createTruckMarkerElement(),
                zIndex: 1000,
            });

            const routeListeners = [];

            if (routeHitArea) {
                routeListeners.push(
                    routeHitArea.addListener('mouseover', (event) => {
                        const pointerPosition = event?.latLng || sourceMarker?.getPosition() || truckMarker.getPosition();
                        tripInfoWindowRef.current?.setContent(buildTripInfoHtml(trip));

                        if (pointerPosition) {
                            tripInfoWindowRef.current?.setPosition(pointerPosition);
                        }

                        tripInfoWindowRef.current?.open({ map });
                    })
                );

                routeListeners.push(
                    routeHitArea.addListener('mousemove', (event) => {
                        if (event?.latLng) {
                            tripInfoWindowRef.current?.setPosition(event.latLng);
                        }
                    })
                );

                routeListeners.push(
                    routeHitArea.addListener('mouseout', () => {
                        tripInfoWindowRef.current?.close();
                    })
                );
            }

            const truckListeners = [
                truckMarker.addListener('mouseover', () => {
                    truckInfoWindowRef.current?.setContent(buildTruckInfoHtml(trip, liveLocation));
                    truckInfoWindowRef.current?.open({ map, anchor: truckMarker });
                }),
                truckMarker.addListener('mouseout', () => {
                    truckInfoWindowRef.current?.close();
                }),
            ];

            tripLayersRef.current.set(String(trip.id), {
                sourceMarker,
                destinationMarker,
                routePolyline,
                routeHitArea,
                truckMarker,
                routeListeners,
                truckListeners,
            });

            bounds.extend(truckPosition);

            if (sourceMarker) {
                bounds.extend(sourcePosition);
            }

            if (destinationMarker) {
                bounds.extend(destinationPosition);
            }

            routePath.forEach((point) => bounds.extend(point));
        });

        currentBoundsRef.current = bounds;

        if (bounds.isEmpty()) {
            if (!hasInitialFit) {
                map.setCenter(DEFAULT_CENTER);
                map.setZoom(DEFAULT_ZOOM);
            }
            return;
        }

        if (!hasInitialFit) {
            map.fitBounds(bounds, 80);
            setHasInitialFit(true);
        }
    }, [activeTrips, isMapReady, hasInitialFit]);

    const handleFitAllTrips = () => {
        const map = mapInstanceRef.current;
        const bounds = currentBoundsRef.current;
        if (map && bounds && !bounds.isEmpty()) {
            map.fitBounds(bounds, 80);
        }
    };

    return (
        <section className="flex-1 flex flex-col p-4 bg-surface-container-low min-h-0 overflow-hidden">
            {/* Map Canvas - Contained UI Element */}
            <div className="flex-1 w-full relative rounded-2xl overflow-hidden border border-outline-variant/30 shadow-sm shadow-black/5 bg-white">
                {/* Map Container - Base Layer */}
                <div
                    id="map-container"
                    ref={mapRef}
                    className="absolute inset-0 w-full h-full z-0"
                ></div>

                <button
                    onClick={handleFitAllTrips}
                    className="absolute bottom-6 right-6 z-10 bg-white p-3 rounded-full shadow-lg border border-outline-variant/30 text-secondary hover:text-primary transition-colors cursor-pointer flex items-center justify-center"
                    title="Fit all trips on screen"
                >
                    <span className="material-symbols-outlined">zoom_out_map</span>
                </button>

                {mapError ? (
                    <div className="absolute top-4 left-4 z-10 max-w-md bg-error/95 text-white border border-error rounded-xl px-4 py-3 shadow-lg shadow-black/10">
                        <p className="text-sm font-medium">{mapError}</p>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
