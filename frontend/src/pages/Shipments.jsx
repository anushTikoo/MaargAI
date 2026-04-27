import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTrucksForCurrentUser } from '../services/trucksService';
import { createTripForCurrentUser, deleteTripForCurrentUser, getTripsForCurrentUser } from '../services/tripsService';

const PLACES_SEARCH_DEBOUNCE_MS = 1000;
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
const GOOGLE_PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_PLACES_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

function createPlacesSessionToken() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fetchPlaceSuggestions(input, sessionToken) {
    const response = await fetch(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
        },
        body: JSON.stringify({
            input,
            sessionToken,
            languageCode: 'en',
        }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to load place suggestions.');
    }

    return Array.isArray(data?.suggestions)
        ? data.suggestions
              .map((item) => ({
                  placeId: item?.placePrediction?.placeId,
                  description: item?.placePrediction?.text?.text,
              }))
              .filter((item) => item.placeId && item.description)
        : [];
}

async function fetchPlaceLatLng(placeId) {
    const response = await fetch(`${GOOGLE_PLACES_DETAILS_BASE_URL}/${encodeURIComponent(placeId)}`, {
        method: 'GET',
        headers: {
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'id,formattedAddress,location',
        },
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to fetch place details.');
    }

    const latitude = Number(data?.location?.latitude);
    const longitude = Number(data?.location?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Selected place does not have a valid latitude/longitude.');
    }

    return {
        lat: latitude,
        lng: longitude,
        address: typeof data?.formattedAddress === 'string' ? data.formattedAddress.trim() : '',
    };
}

function formatCoordinate(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return 'N/A';
    }

    return numericValue.toFixed(5);
}

function formatDateLabel(value) {
    if (!value) {
        return 'No deadline';
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return 'No deadline';
    }

    return parsed.toLocaleString();
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

function formatEtaSeconds(value) {
    const totalSeconds = Number(value);

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return 'N/A';
    }

    const roundedSeconds = Math.round(totalSeconds);
    const days = Math.floor(roundedSeconds / 86400);
    const hours = Math.floor((roundedSeconds % 86400) / 3600);
    const minutes = Math.floor((roundedSeconds % 3600) / 60);

    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    if (minutes > 0) {
        return `${minutes}m`;
    }

    return `${roundedSeconds}s`;
}

function formatArrivalTime(value) {
    const totalSeconds = Number(value);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return 'N/A';
    }
    const arrivalDate = new Date(Date.now() + totalSeconds * 1000);
    return arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTime24h(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function getValidTimestamp(value) {
    if (!value) {
        return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function sortTripsForDisplay(trips) {
    return [...trips].sort((leftTrip, rightTrip) => {
        const leftDeadlineTimestamp = getValidTimestamp(leftTrip?.deadline_timestamp);
        const rightDeadlineTimestamp = getValidTimestamp(rightTrip?.deadline_timestamp);
        const leftHasDeadline = Number.isFinite(leftDeadlineTimestamp);
        const rightHasDeadline = Number.isFinite(rightDeadlineTimestamp);

        // Always keep trips with deadlines above trips without deadlines.
        if (leftHasDeadline !== rightHasDeadline) {
            return leftHasDeadline ? -1 : 1;
        }

        // If both have deadlines, sort by earliest deadline first.
        if (leftHasDeadline && rightHasDeadline && leftDeadlineTimestamp !== rightDeadlineTimestamp) {
            return leftDeadlineTimestamp - rightDeadlineTimestamp;
        }

        // If both do not have deadlines, sort by created_at (older first).
        const leftCreatedTimestamp = getValidTimestamp(leftTrip?.created_at);
        const rightCreatedTimestamp = getValidTimestamp(rightTrip?.created_at);

        if (Number.isFinite(leftCreatedTimestamp) && Number.isFinite(rightCreatedTimestamp) && leftCreatedTimestamp !== rightCreatedTimestamp) {
            return leftCreatedTimestamp - rightCreatedTimestamp;
        }

        if (Number.isFinite(leftCreatedTimestamp) !== Number.isFinite(rightCreatedTimestamp)) {
            return Number.isFinite(leftCreatedTimestamp) ? -1 : 1;
        }

        return Number(leftTrip?.id || 0) - Number(rightTrip?.id || 0);
    });
}

export default function Shipments() {
    const [sourceAddress, setSourceAddress] = useState('');
    const [destinationAddress, setDestinationAddress] = useState('');
    const [sourceSuggestions, setSourceSuggestions] = useState([]);
    const [destinationSuggestions, setDestinationSuggestions] = useState([]);
    const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
    const [isDestinationDropdownOpen, setIsDestinationDropdownOpen] = useState(false);
    const [isSourceSearching, setIsSourceSearching] = useState(false);
    const [isDestinationSearching, setIsDestinationSearching] = useState(false);
    const [sourcePlaceId, setSourcePlaceId] = useState('');
    const [destinationPlaceId, setDestinationPlaceId] = useState('');
    const [deadline, setDeadline] = useState('');
    const [selectedTruckId, setSelectedTruckId] = useState('');
    const [fleetTrucks, setFleetTrucks] = useState([]);
    const [isLoadingFleetTrucks, setIsLoadingFleetTrucks] = useState(true);
    const [fleetTrucksError, setFleetTrucksError] = useState('');
    const [trips, setTrips] = useState([]);
    const [isLoadingTrips, setIsLoadingTrips] = useState(true);
    const [tripsError, setTripsError] = useState('');
    const [simulatingTripId, setSimulatingTripId] = useState(null);
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingTripId, setDeletingTripId] = useState(null);
    // Delete modal state
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [tripToDelete, setTripToDelete] = useState(null);
    const [expandedReasoningTripIds, setExpandedReasoningTripIds] = useState(new Set());

    const sourceSearchTimeoutRef = useRef(null);
    const destinationSearchTimeoutRef = useRef(null);
    const sourceSearchRequestIdRef = useRef(0);
    const destinationSearchRequestIdRef = useRef(0);
    const sourceSessionTokenRef = useRef(createPlacesSessionToken());
    const destinationSessionTokenRef = useRef(createPlacesSessionToken());
    const displayTrips = sortTripsForDisplay(trips);

    useEffect(() => {
        return () => {
            if (sourceSearchTimeoutRef.current) {
                clearTimeout(sourceSearchTimeoutRef.current);
            }
            if (destinationSearchTimeoutRef.current) {
                clearTimeout(destinationSearchTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!deleteModalOpen) {
            return undefined;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [deleteModalOpen]);

    useEffect(() => {
        let ignoreResult = false;

        async function loadFleetTrucks() {
            setIsLoadingFleetTrucks(true);
            setFleetTrucksError('');

            try {
                const { trucks } = await getTrucksForCurrentUser();

                if (ignoreResult) {
                    return;
                }

                const normalizedTrucks = Array.isArray(trucks) ? trucks : [];
                setFleetTrucks(normalizedTrucks);

                if (normalizedTrucks.length === 0) {
                    setFleetTrucksError('No trucks found in your fleet. Add a truck first to create shipments.');
                }
            } catch (error) {
                if (!ignoreResult) {
                    setFleetTrucks([]);
                    setFleetTrucksError(error?.message || 'Unable to load fleet trucks.');
                }
            } finally {
                if (!ignoreResult) {
                    setIsLoadingFleetTrucks(false);
                }
            }
        }

        loadFleetTrucks();

        return () => {
            ignoreResult = true;
        };
    }, []);

    useEffect(() => {
        let ignoreResult = false;

        async function loadTrips() {
            setIsLoadingTrips(true);
            setTripsError('');

            try {
                const { trips: fetchedTrips } = await getTripsForCurrentUser();

                if (ignoreResult) {
                    return;
                }

                setTrips(Array.isArray(fetchedTrips) ? fetchedTrips : []);
            } catch (error) {
                if (!ignoreResult) {
                    setTrips([]);
                    setTripsError(error?.message || 'Unable to load trips.');
                }
            } finally {
                if (!ignoreResult) {
                    setIsLoadingTrips(false);
                }
            }
        }

        loadTrips();

        return () => {
            ignoreResult = true;
        };
    }, []);

    const searchSourceSuggestions = (value) => {
        setSourceAddress(value);
        setSourcePlaceId('');
        setFormError('');

        if (sourceSearchTimeoutRef.current) {
            clearTimeout(sourceSearchTimeoutRef.current);
        }

        if (!GOOGLE_PLACES_API_KEY) {
            setSourceSuggestions([]);
            setIsSourceDropdownOpen(false);
            setIsSourceSearching(false);
            return;
        }

        const trimmedValue = value.trim();

        if (!trimmedValue) {
            setSourceSuggestions([]);
            setIsSourceDropdownOpen(false);
            setIsSourceSearching(false);
            return;
        }

        setIsSourceDropdownOpen(true);
        setIsSourceSearching(true);
        const currentRequestId = sourceSearchRequestIdRef.current + 1;
        sourceSearchRequestIdRef.current = currentRequestId;

        sourceSearchTimeoutRef.current = setTimeout(async () => {
            try {
                const suggestions = await fetchPlaceSuggestions(trimmedValue, sourceSessionTokenRef.current);

                if (sourceSearchRequestIdRef.current !== currentRequestId) {
                    return;
                }

                setSourceSuggestions(suggestions);
            } catch (error) {
                if (sourceSearchRequestIdRef.current === currentRequestId) {
                    setSourceSuggestions([]);
                    setFormError(error?.message || 'Unable to search source locations.');
                }
            } finally {
                if (sourceSearchRequestIdRef.current === currentRequestId) {
                    setIsSourceSearching(false);
                }
            }
        }, PLACES_SEARCH_DEBOUNCE_MS);
    };

    const searchDestinationSuggestions = (value) => {
        setDestinationAddress(value);
        setDestinationPlaceId('');
        setFormError('');

        if (destinationSearchTimeoutRef.current) {
            clearTimeout(destinationSearchTimeoutRef.current);
        }

        if (!GOOGLE_PLACES_API_KEY) {
            setDestinationSuggestions([]);
            setIsDestinationDropdownOpen(false);
            setIsDestinationSearching(false);
            return;
        }

        const trimmedValue = value.trim();

        if (!trimmedValue) {
            setDestinationSuggestions([]);
            setIsDestinationDropdownOpen(false);
            setIsDestinationSearching(false);
            return;
        }

        setIsDestinationDropdownOpen(true);
        setIsDestinationSearching(true);
        const currentRequestId = destinationSearchRequestIdRef.current + 1;
        destinationSearchRequestIdRef.current = currentRequestId;

        destinationSearchTimeoutRef.current = setTimeout(async () => {
            try {
                const suggestions = await fetchPlaceSuggestions(trimmedValue, destinationSessionTokenRef.current);

                if (destinationSearchRequestIdRef.current !== currentRequestId) {
                    return;
                }

                setDestinationSuggestions(suggestions);
            } catch (error) {
                if (destinationSearchRequestIdRef.current === currentRequestId) {
                    setDestinationSuggestions([]);
                    setFormError(error?.message || 'Unable to search destination locations.');
                }
            } finally {
                if (destinationSearchRequestIdRef.current === currentRequestId) {
                    setIsDestinationSearching(false);
                }
            }
        }, PLACES_SEARCH_DEBOUNCE_MS);
    };

    const selectSourceSuggestion = (suggestion) => {
        if (sourceSearchTimeoutRef.current) {
            clearTimeout(sourceSearchTimeoutRef.current);
        }
        sourceSearchRequestIdRef.current += 1;
        setIsSourceSearching(false);
        setSourcePlaceId(suggestion.placeId);
        setSourceAddress(suggestion.description);
        setSourceSuggestions([]);
        setIsSourceDropdownOpen(false);
        setFormError('');

        sourceSessionTokenRef.current = createPlacesSessionToken();
    };

    const selectDestinationSuggestion = (suggestion) => {
        if (destinationSearchTimeoutRef.current) {
            clearTimeout(destinationSearchTimeoutRef.current);
        }
        destinationSearchRequestIdRef.current += 1;
        setIsDestinationSearching(false);
        setDestinationPlaceId(suggestion.placeId);
        setDestinationAddress(suggestion.description);
        setDestinationSuggestions([]);
        setIsDestinationDropdownOpen(false);
        setFormError('');

        destinationSessionTokenRef.current = createPlacesSessionToken();
    };

    const refreshTrips = async () => {
        const { trips: refreshedTrips } = await getTripsForCurrentUser();
        setTrips(Array.isArray(refreshedTrips) ? refreshedTrips : []);
    };

    const handleDeleteClick = (trip) => {
        setTripToDelete(trip);
        setDeleteModalOpen(true);
    };

    const confirmDeleteTrip = async () => {
        const trip = tripToDelete;
        if (!trip) return;

        setTripsError('');

        try {
            setDeletingTripId(trip.id);
            await deleteTripForCurrentUser(trip.id);
            await refreshTrips();
            setDeleteModalOpen(false);
            setTripToDelete(null);
        } catch (error) {
            setTripsError(error?.message || 'Unable to delete trip.');
        } finally {
            setDeletingTripId(null);
        }
    };

    const handleAddShipment = async () => {
        setFormError('');
        setFormSuccess('');

        if (!selectedTruckId) {
            setFormError('Truck is required. Select one truck from your fleet.');
            return;
        }

        if (!sourceAddress.trim() || !destinationAddress.trim()) {
            setFormError('Source and Destination are required.');
            return;
        }

        if (!sourcePlaceId || !destinationPlaceId) {
            setFormError('Select valid Source and Destination from Google suggestions before adding shipment.');
            return;
        }

        const selectedTruck = fleetTrucks.find((truck) => String(truck.id) === selectedTruckId);

        if (!selectedTruck) {
            setFormError('Selected truck is not available in your fleet anymore. Please select again.');
            return;
        }

        try {
            setIsSubmitting(true);

            // Convert source and destination into coordinates before sending create-trip request.
            const latestSourceLocation = await fetchPlaceLatLng(sourcePlaceId);
            const latestDestinationLocation = await fetchPlaceLatLng(destinationPlaceId);
            const normalizedSourceText = latestSourceLocation.address || sourceAddress.trim();
            const normalizedDestinationText = latestDestinationLocation.address || destinationAddress.trim();

            const normalizedDeadline = deadline ? new Date(deadline) : null;
            const deadlineTimestamp =
                normalizedDeadline && !Number.isNaN(normalizedDeadline.getTime())
                    ? normalizedDeadline.toISOString()
                    : null;

            await createTripForCurrentUser({
                truckId: selectedTruck.id,
                source: normalizedSourceText,
                destination: normalizedDestinationText,
                sourceLat: latestSourceLocation.lat,
                sourceLng: latestSourceLocation.lng,
                destLat: latestDestinationLocation.lat,
                destLng: latestDestinationLocation.lng,
                deadlineTimestamp,
            });

            try {
                await refreshTrips();
                setTripsError('');
            } catch (refreshError) {
                setTripsError(refreshError?.message || 'Trip created, but failed to refresh trip list.');
            }

            setFormSuccess(`Trip for truck ${selectedTruck.truck_number} added successfully.`);

            setSourceAddress('');
            setDestinationAddress('');
            setSourcePlaceId('');
            setDestinationPlaceId('');
            setSourceSuggestions([]);
            setDestinationSuggestions([]);
            setDeadline('');
            setSelectedTruckId('');
        } catch (error) {
            setFormError(error?.message || 'Unable to add shipment.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section
            className="flex-1 bg-surface-bright p-8 md:p-12 bg-[radial-gradient(circle,#e2e2e5_1px,transparent_1px)] overflow-y-auto"
            style={{ backgroundSize: '32px 32px' }}
        >
            <div className="max-w-5xl mx-auto space-y-12">
                <div className="relative">
                    <h1 className="text-4xl font-black text-on-surface mb-4">Shipments</h1>
                    <p className="text-secondary max-w-xl text-md">
                        View shipments and add new ones from a single workspace.
                    </p>
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-8 shadow-sm">
                    <div className="flex items-center justify-between gap-4 mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-on-surface">Current Trips</h2>
                            <p className="text-sm text-secondary mt-1">Trips created from this workspace, with live route details from the backend.</p>
                        </div>
                        <div className="hidden sm:flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-secondary bg-surface-container-low px-3 py-2 rounded-full border border-outline-variant/20">
                            <span className="material-symbols-outlined text-[1rem]">route</span>
                            {displayTrips.length} total
                        </div>
                    </div>

                    {isLoadingTrips ? (
                        <div className="flex items-center gap-3 text-sm text-secondary py-4">
                            <span className="material-symbols-outlined animate-pulse text-[1.1rem]">progress_activity</span>
                            Loading trips...
                        </div>
                    ) : tripsError ? (
                        <div className="rounded-lg border border-error/20 bg-error/5 px-4 py-3 text-sm text-error">
                            {tripsError}
                        </div>
                    ) : displayTrips.length === 0 ? (
                        <div className="flex flex-col items-center text-center py-8">
                            <div className="w-14 h-14 bg-surface-container-low rounded-full flex items-center justify-center mb-4">
                                <span className="material-symbols-outlined text-secondary text-2xl">inventory_2</span>
                            </div>
                            <p className="text-on-surface font-semibold mb-1">No trips created yet</p>
                            <p className="text-secondary text-sm">Create a trip below and it will appear here.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {displayTrips.map((trip, index) => (
                                <article
                                    key={trip.id}
                                    className={`group overflow-hidden rounded-2xl border ${trip.status === 'active' && !trip.current_route_is_ai_recommended ? 'border-primary/30 bg-primary/[0.02]' : 'border-outline-variant/20 bg-surface-container-lowest'} shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}
                                >
                                    <div className="h-1 w-full bg-linear-to-r from-primary via-primary-container to-secondary/50"></div>
                                    <div className="p-5 md:p-6 space-y-3">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="space-y-1.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex items-center rounded-full bg-on-surface/5 px-3 py-1 text-lg font-black uppercase tracking-[0.08em] text-on-surface">
                                                        Trip {index + 1}
                                                    </span>
                                                    <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-primary">
                                                        <span className="material-symbols-outlined text-[1rem]">local_shipping</span>
                                                        Truck {trip.truck_number || `#${trip.truck_id}`}
                                                    </span>
                                                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] ${
                                                        trip.status === 'completed' 
                                                            ? 'bg-green-50 text-green-700' 
                                                            : trip.status === 'active' && !trip.current_route_is_ai_recommended
                                                                ? 'bg-primary/10 text-primary animate-pulse'
                                                                : 'bg-secondary/10 text-secondary'
                                                    }`}>
                                                        <span className="material-symbols-outlined text-[1rem]">
                                                            {trip.status === 'completed' 
                                                                ? 'check_circle' 
                                                                : trip.status === 'active' && !trip.ai_decision 
                                                                    ? 'psychology' 
                                                                    : 'schedule'}
                                                        </span>
                                                        {trip.status === 'active' && !trip.ai_decision ? 'Analyzing' : (trip.status || 'active')}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-secondary">
                                                    Created {formatDateLabel(trip.created_at)}
                                                </p>
                                            </div>

                                            {trip.status !== 'not started' && (
                                                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 min-w-44 flex flex-col justify-center">
                                                    {trip.status === 'active' && !trip.ai_decision ? (
                                                        <div className="flex flex-col items-center justify-center text-center">
                                                            <div className="flex items-center gap-2 text-primary font-bold animate-pulse mb-1">
                                                                <span className="material-symbols-outlined text-[1.2rem] animate-spin" style={{ animationDuration: '3s' }}>data_usage</span>
                                                                Analyzing...
                                                            </div>
                                                            <p className="text-[10px] text-secondary leading-tight uppercase tracking-wider font-semibold">
                                                                MaargAI Route Evaluation
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="text-[0.7rem] font-black uppercase tracking-[0.12em] text-secondary mb-1">Expected Arrival</p>
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-end gap-2">
                                                                    <span className="material-symbols-outlined text-primary text-[1.15rem]">schedule</span>
                                                                    <span className="text-2xl font-black text-on-surface leading-none">
                                                                        {formatArrivalTime(trip.live_eta_seconds || trip.current_route_duration_seconds || trip.baseline_eta_seconds)}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 text-[0.65rem] text-secondary font-bold uppercase tracking-wider ml-1">
                                                                    <span className="material-symbols-outlined text-[0.85rem]">timer</span>
                                                                    {formatEtaSeconds(trip.live_eta_seconds || trip.current_route_duration_seconds || trip.baseline_eta_seconds).replace(/ \d+s$/, '').replace(/^\d+s$/, '< 1m')} remaining
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                                                <div className="flex items-center gap-2 mb-2 text-secondary">
                                                    <span className="material-symbols-outlined text-[1rem]">trip_origin</span>
                                                    <span className="text-md font-black uppercase tracking-[0.12em]">Source</span>
                                                </div>
                                                <p className="text-sm font-semibold text-on-surface break-all">
                                                    {trip.source || `${formatCoordinate(trip.source_lat)}, ${formatCoordinate(trip.source_lng)}`}
                                                </p>
                                            </div>

                                            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                                                <div className="flex items-center gap-2 mb-2 text-secondary">
                                                    <span className="material-symbols-outlined text-[1rem]">flag</span>
                                                    <span className="text-md font-black uppercase tracking-[0.12em]">Destination</span>
                                                </div>
                                                <p className="text-sm font-semibold text-on-surface break-all">
                                                    {trip.destination || `${formatCoordinate(trip.dest_lat)}, ${formatCoordinate(trip.dest_lng)}`}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-2 pt-1">
                                            <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1 text-xs font-semibold text-secondary border border-outline-variant/20">
                                                <span className="material-symbols-outlined text-[0.95rem]">event</span>
                                                Deadline: {formatDateLabel(trip.deadline_timestamp)}
                                            </span>
                                            {trip.status !== 'not started' && (
                                                trip.current_route_is_ai_recommended ? (
                                                    <>
                                                        <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1 text-xs font-semibold text-secondary border border-outline-variant/20">
                                                            <span className="material-symbols-outlined text-[0.95rem]">straighten</span>
                                                            Distance: {formatDistanceMeters(trip.live_distance_meters || trip.current_route_distance_meters || trip.baseline_distance_meters)}
                                                        </span>
                                                        <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1 text-xs font-semibold text-secondary border border-outline-variant/20">
                                                            <span className="material-symbols-outlined text-[0.95rem]">toll</span>
                                                            Tolls: {trip.current_route_has_tolls ? 'Yes' : 'No'}
                                                        </span>
                                                        <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-3 py-1 text-xs font-semibold text-green-700 border border-green-200 bg-green-50">
                                                            <span className="material-symbols-outlined text-[0.95rem]">payments</span>
                                                            Cost: ₹{trip.current_route_ai_total_cost_inr || 0}
                                                        </span>
                                                        {trip.current_route_ai_slack_time_hours !== null && (
                                                            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border ${
                                                                Number((trip.live_slack_time_hours !== null && trip.live_slack_time_hours !== undefined) 
                                                                    ? trip.live_slack_time_hours 
                                                                    : (trip.current_route_ai_slack_time_hours || 0)
                                                                ) < 0 
                                                                    ? 'bg-red-50 text-red-700 border-red-200' 
                                                                    : Number(trip.current_route_ai_slack_time_hours) < 0.5 
                                                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                        : 'bg-green-50 text-green-700 border-green-200'
                                                            }`}>
                                                                <span className="material-symbols-outlined text-[0.95rem]">hourglass_empty</span>
                                                                Slack: {trip.current_route_ai_slack_time_hours}h
                                                            </span>
                                                        )}
                                                        {trip.current_route_ai_risk_level && trip.current_route_ai_risk_level !== 'low' && (
                                                            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border uppercase tracking-wider ${
                                                                trip.current_route_ai_risk_level === 'high' 
                                                                    ? 'bg-red-50 text-red-700 border-red-200' 
                                                                    : trip.current_route_ai_risk_level === 'medium' 
                                                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                        : 'bg-green-50 text-green-700 border-green-200'
                                                            }`}>
                                                                <span className="material-symbols-outlined text-[0.95rem]">
                                                                    {trip.current_route_ai_risk_level === 'high' ? 'warning' : 'verified_user'}
                                                                </span>
                                                                {trip.current_route_ai_risk_level} Risk
                                                            </span>
                                                        )}
                                                    </>
                                                ) : trip.status === 'active' && (
                                                    <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                                                        <span className="material-symbols-outlined text-[0.95rem]">route</span>
                                                        Awaiting best route
                                                    </span>
                                                )
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteClick(trip)}
                                                disabled={deletingTripId === trip.id}
                                                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-transparent bg-transparent px-3 py-1 text-xs font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:border-red-100 disabled:bg-transparent disabled:text-red-300 disabled:opacity-60"
                                            >
                                                <span className="material-symbols-outlined text-[0.95rem]">
                                                    {deletingTripId === trip.id ? 'progress_activity' : 'delete'}
                                                </span>
                                                {deletingTripId === trip.id ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </div>

                                        {/* AI Insight & Simulation Controller */}
                                        {trip.status === 'active' && (
                                            <div className="mt-4 pt-4 border-t border-outline-variant/10 flex flex-col gap-3">
                                                {trip.ai_reroute_reason && (
                                                    <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2 text-primary font-bold">
                                                                <span className="material-symbols-outlined text-[1.1rem]">psychology</span>
                                                                Agent Insight
                                                            </div>
                                                            {trip.ai_decision === 'reroute' ? (
                                                                <span className="bg-amber-100 text-amber-800 text-[10px] font-black uppercase px-2 py-0.5 rounded border border-amber-200">
                                                                    🔄 Reroute Advised
                                                                </span>
                                                            ) : (
                                                                <span className="bg-green-100 text-green-800 text-[10px] font-black uppercase px-2 py-0.5 rounded border border-green-200">
                                                                    ✅ Stay the Course
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-secondary leading-relaxed whitespace-pre-wrap">
                                                            {expandedReasoningTripIds.has(trip.id) 
                                                                ? trip.ai_reroute_reason 
                                                                : (trip.ai_reroute_reason.length > 150 
                                                                    ? trip.ai_reroute_reason.substring(0, 150) + '...' 
                                                                    : trip.ai_reroute_reason)
                                                            }
                                                            {trip.ai_reroute_reason.length > 150 && (
                                                                <button
                                                                    onClick={() => {
                                                                        const next = new Set(expandedReasoningTripIds);
                                                                        if (next.has(trip.id)) next.delete(trip.id);
                                                                        else next.add(trip.id);
                                                                        setExpandedReasoningTripIds(next);
                                                                    }}
                                                                    className="ml-2 text-primary font-bold hover:underline inline-flex items-center gap-1"
                                                                >
                                                                    {expandedReasoningTripIds.has(trip.id) ? 'Show Less' : 'Show More'}
                                                                    <span className="material-symbols-outlined text-[1rem]">
                                                                        {expandedReasoningTripIds.has(trip.id) ? 'expand_less' : 'expand_more'}
                                                                    </span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {trip.status === 'active' && (
                                            <div className="mt-6 pt-6 border-t border-outline-variant/10">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                                    <div className="flex flex-col gap-3">
                                                        <div className="flex items-center gap-2 text-secondary">
                                                            <span className="material-symbols-outlined text-[1rem]">sensors</span>
                                                            <span className="text-[0.65rem] font-black uppercase tracking-[0.15em]">Live Telemetry</span>
                                                        </div>
                                                        <div className="flex flex-wrap gap-4">
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-secondary font-bold uppercase tracking-wider">Last Update</span>
                                                                <span className="text-sm font-black text-on-surface">{formatTime24h(trip.last_location_at)}</span>
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-secondary font-bold uppercase tracking-wider">Coordinates</span>
                                                                <span className="text-sm font-bold text-primary font-mono">
                                                                    {trip.last_gps_lat?.toFixed(5)}, {trip.last_gps_lng?.toFixed(5)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-col gap-3 bg-surface-container-low/50 rounded-xl p-4 border border-outline-variant/10 min-w-[280px]">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2 text-secondary">
                                                                <span className="material-symbols-outlined text-[1rem]">engineering</span>
                                                                <span className="text-[0.65rem] font-black uppercase tracking-[0.15em]">Worker Node</span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                                                <span className="text-[10px] font-bold text-green-700 uppercase">Active</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-secondary font-bold uppercase tracking-wider">Last Run</span>
                                                                <span className="text-xs font-black text-on-surface">{formatTime24h(trip.last_checked_at)}</span>
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-secondary font-bold uppercase tracking-wider">ETA Sync</span>
                                                                <span className="text-xs font-bold text-green-600 flex items-center gap-1">
                                                                    <span className="material-symbols-outlined text-[0.9rem]">check_circle</span>
                                                                    Updated
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-secondary font-bold uppercase tracking-wider">AI Evaluation</span>
                                                                <span className="text-xs font-black text-on-surface">
                                                                    {trip.last_ai_trigger_at ? formatTime24h(trip.last_ai_trigger_at) : 'Not Evaluated'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </div>

                {/* DELETE MODAL */}
                {deleteModalOpen && typeof document !== 'undefined'
                    ? createPortal(
                          <div className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/50 p-4 backdrop-blur-md">
                              <div className="bg-surface-container-lowest rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
                                  <div className="w-16 h-16 bg-error-container rounded-full flex items-center justify-center mb-6 mx-auto">
                                      <span className="material-symbols-outlined text-on-error-container text-3xl">delete_forever</span>
                                  </div>
                                  <h3 className="text-2xl font-black text-center text-on-surface mb-2">Delete Trip?</h3>
                                  <p className="text-center text-secondary mb-8">
                                      Are you sure you want to delete the trip for truck <span className="font-bold text-on-surface">{tripToDelete?.truck_number || `#${tripToDelete?.truck_id || tripToDelete?.id}`}</span>? This action cannot be undone.
                                  </p>
                                  <div className="flex gap-4">
                                      <button
                                          onClick={() => {
                                              setDeleteModalOpen(false);
                                              setTripToDelete(null);
                                          }}
                                          className="flex-1 px-4 py-3 rounded-lg border-2 border-outline-variant text-secondary font-bold hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
                                      >
                                          Cancel
                                      </button>
                                      <button
                                          onClick={confirmDeleteTrip}
                                          className="flex-1 px-4 py-3 rounded-lg bg-error text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-error/20 cursor-pointer border-none"
                                      >
                                          {deletingTripId ? 'Deleting...' : 'Delete'}
                                      </button>
                                  </div>
                              </div>
                          </div>,
                          document.body,
                      )
                    : null}

                <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                    <h2 className="text-xl font-bold text-on-surface mb-8">Add Shipment</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div className="space-y-8">
                            <div>
                                <label className="block text-xs font-black uppercase text-secondary mb-3" style={{ letterSpacing: '0.1em' }}>
                                    Source Address
                                </label>
                                <div className="relative">
                                    <input
                                        className="w-full bg-surface-container-low border-b-2 border-transparent focus:border-primary focus:bg-surface transition-all px-4 py-3 text-lg font-medium outline-none"
                                        placeholder="Search source via Google Places"
                                        type="text"
                                        value={sourceAddress}
                                        onFocus={() => {
                                            if (sourceSuggestions.length > 0) {
                                                setIsSourceDropdownOpen(true);
                                            }
                                        }}
                                        onBlur={() => {
                                            setTimeout(() => setIsSourceDropdownOpen(false), 150);
                                        }}
                                        onChange={(e) => searchSourceSuggestions(e.target.value)}
                                    />
                                    {isSourceDropdownOpen ? (
                                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest shadow-lg max-h-56 overflow-y-auto">
                                            {isSourceSearching ? (
                                                <p className="px-4 py-3 text-sm text-secondary">Searching locations...</p>
                                            ) : sourceSuggestions.length > 0 ? (
                                                sourceSuggestions.map((suggestion) => (
                                                    <button
                                                        type="button"
                                                        key={suggestion.placeId}
                                                        onMouseDown={() => selectSourceSuggestion(suggestion)}
                                                        className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low transition-colors border-none cursor-pointer"
                                                    >
                                                        {suggestion.description}
                                                    </button>
                                                ))
                                            ) : (
                                                <p className="px-4 py-3 text-sm text-secondary">No locations found.</p>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-black uppercase text-secondary mb-3" style={{ letterSpacing: '0.1em' }}>
                                    Destination Address
                                </label>
                                <div className="relative">
                                    <input
                                        className="w-full bg-surface-container-low border-b-2 border-transparent focus:border-primary focus:bg-surface transition-all px-4 py-3 text-lg font-medium outline-none"
                                        placeholder="Search destination via Google Places"
                                        type="text"
                                        value={destinationAddress}
                                        onFocus={() => {
                                            if (destinationSuggestions.length > 0) {
                                                setIsDestinationDropdownOpen(true);
                                            }
                                        }}
                                        onBlur={() => {
                                            setTimeout(() => setIsDestinationDropdownOpen(false), 150);
                                        }}
                                        onChange={(e) => searchDestinationSuggestions(e.target.value)}
                                    />
                                    {isDestinationDropdownOpen ? (
                                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest shadow-lg max-h-56 overflow-y-auto">
                                            {isDestinationSearching ? (
                                                <p className="px-4 py-3 text-sm text-secondary">Searching locations...</p>
                                            ) : destinationSuggestions.length > 0 ? (
                                                destinationSuggestions.map((suggestion) => (
                                                    <button
                                                        type="button"
                                                        key={suggestion.placeId}
                                                        onMouseDown={() => selectDestinationSuggestion(suggestion)}
                                                        className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low transition-colors border-none cursor-pointer"
                                                    >
                                                        {suggestion.description}
                                                    </button>
                                                ))
                                            ) : (
                                                <p className="px-4 py-3 text-sm text-secondary">No locations found.</p>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {!GOOGLE_PLACES_API_KEY ? (
                                <p className="text-xs text-error">
                                    Google Places API key missing. Set VITE_GOOGLE_PLACES_API_KEY in frontend/.env.
                                </p>
                            ) : null}
                        </div>

                        <div className="space-y-8">
                            <div>
                                <label className="block text-xs font-black uppercase text-secondary mb-3" style={{ letterSpacing: '0.1em' }}>
                                    Truck (Required)
                                </label>
                                <select
                                    className="w-full bg-surface-container-low border-b-2 border-transparent focus:border-primary focus:bg-surface transition-all px-4 py-3 text-lg font-medium outline-none"
                                    value={selectedTruckId}
                                    onChange={(e) => setSelectedTruckId(e.target.value)}
                                    disabled={isLoadingFleetTrucks || fleetTrucks.length === 0}
                                    required
                                >
                                    <option value="">
                                        {isLoadingFleetTrucks
                                            ? 'Loading fleet trucks...'
                                            : fleetTrucks.length === 0
                                              ? 'No trucks available'
                                              : 'Select a truck from your fleet'}
                                    </option>
                                    {fleetTrucks.map((truck) => (
                                        <option key={truck.id} value={String(truck.id)}>
                                            {truck.truck_number} ({truck.truck_type})
                                        </option>
                                    ))}
                                </select>
                                {fleetTrucksError ? <p className="mt-2 text-xs text-error">{fleetTrucksError}</p> : null}
                            </div>

                            <div>
                                <label className="block text-xs font-black uppercase text-secondary mb-3" style={{ letterSpacing: '0.1em' }}>
                                    Deadline (If Any)
                                </label>
                                <input
                                    className="w-full bg-surface-container-low border-b-2 border-transparent focus:border-primary focus:bg-surface transition-all px-4 py-3 text-lg font-medium outline-none"
                                    type="datetime-local"
                                    value={deadline}
                                    onChange={(e) => setDeadline(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mt-10 flex flex-col items-end">
                        {formError ? <div className="text-error text-sm font-medium mb-3">{formError}</div> : null}
                        {formSuccess ? <div className="text-green-700 text-sm font-medium mb-3">{formSuccess}</div> : null}

                        <button
                            type="button"
                            disabled={isSubmitting || isLoadingFleetTrucks || fleetTrucks.length === 0}
                            onClick={handleAddShipment}
                            className="cursor-pointer bg-primary text-on-primary px-8 py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary-container transition-all shadow-lg active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Adding...' : 'Add Shipment'}
                            <span className="material-symbols-outlined">{isSubmitting ? 'sync' : 'add'}</span>
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
