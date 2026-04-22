import React, { useEffect, useRef, useState } from 'react';
import { getTrucksForCurrentUser } from '../services/trucksService';

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
    };
}

function formatCoordinate(value) {
    return Number(value).toFixed(5);
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

export default function Shipments() {
    const [sourceAddress, setSourceAddress] = useState('');
    const [destinationAddress, setDestinationAddress] = useState('');
    const [sourceSuggestions, setSourceSuggestions] = useState([]);
    const [destinationSuggestions, setDestinationSuggestions] = useState([]);
    const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
    const [isDestinationDropdownOpen, setIsDestinationDropdownOpen] = useState(false);
    const [isSourceSearching, setIsSourceSearching] = useState(false);
    const [isDestinationSearching, setIsDestinationSearching] = useState(false);
    const [sourceLocation, setSourceLocation] = useState(null);
    const [destinationLocation, setDestinationLocation] = useState(null);
    const [sourcePlaceId, setSourcePlaceId] = useState('');
    const [destinationPlaceId, setDestinationPlaceId] = useState('');
    const [deadline, setDeadline] = useState('');
    const [selectedTruckId, setSelectedTruckId] = useState('');
    const [fleetTrucks, setFleetTrucks] = useState([]);
    const [isLoadingFleetTrucks, setIsLoadingFleetTrucks] = useState(true);
    const [fleetTrucksError, setFleetTrucksError] = useState('');
    const [shipments, setShipments] = useState([]);

    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const sourceSearchTimeoutRef = useRef(null);
    const destinationSearchTimeoutRef = useRef(null);
    const sourceSearchRequestIdRef = useRef(0);
    const destinationSearchRequestIdRef = useRef(0);
    const sourceSessionTokenRef = useRef(createPlacesSessionToken());
    const destinationSessionTokenRef = useRef(createPlacesSessionToken());

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

    const searchSourceSuggestions = (value) => {
        setSourceAddress(value);
        setSourceLocation(null);
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
        setDestinationLocation(null);
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

    const selectSourceSuggestion = async (suggestion) => {
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

        try {
            const latLng = await fetchPlaceLatLng(suggestion.placeId);
            setSourceLocation(latLng);
            sourceSessionTokenRef.current = createPlacesSessionToken();
        } catch (error) {
            setSourceLocation(null);
            setFormError(error?.message || 'Unable to fetch source location coordinates.');
        }
    };

    const selectDestinationSuggestion = async (suggestion) => {
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

        try {
            const latLng = await fetchPlaceLatLng(suggestion.placeId);
            setDestinationLocation(latLng);
            destinationSessionTokenRef.current = createPlacesSessionToken();
        } catch (error) {
            setDestinationLocation(null);
            setFormError(error?.message || 'Unable to fetch destination location coordinates.');
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

            const [latestSourceLocation, latestDestinationLocation] = await Promise.all([
                sourceLocation ? Promise.resolve(sourceLocation) : fetchPlaceLatLng(sourcePlaceId),
                destinationLocation ? Promise.resolve(destinationLocation) : fetchPlaceLatLng(destinationPlaceId),
            ]);

            if (!sourceLocation) {
                setSourceLocation(latestSourceLocation);
            }

            if (!destinationLocation) {
                setDestinationLocation(latestDestinationLocation);
            }

            // Keep frontend-only behavior for now until a shipment create endpoint is wired.
            await new Promise((resolve) => setTimeout(resolve, 1000));

            const newShipment = {
                id: Date.now(),
                truckId: selectedTruck.id,
                truckNumber: selectedTruck.truck_number,
                sourceAddress: sourceAddress.trim(),
                destinationAddress: destinationAddress.trim(),
                sourceLat: latestSourceLocation.lat,
                sourceLng: latestSourceLocation.lng,
                destLat: latestDestinationLocation.lat,
                destLng: latestDestinationLocation.lng,
                deadline: deadline || null,
                createdAt: new Date().toISOString(),
            };

            setShipments((current) => [newShipment, ...current]);
            setFormSuccess(`Shipment for truck ${selectedTruck.truck_number} added successfully.`);

            setSourceAddress('');
            setDestinationAddress('');
            setSourceLocation(null);
            setDestinationLocation(null);
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
                    <h2 className="text-xl font-bold text-on-surface mb-6">Current Shipments</h2>

                    {shipments.length === 0 ? (
                        <div className="flex flex-col items-center text-center py-8">
                            <div className="w-14 h-14 bg-surface-container-low rounded-full flex items-center justify-center mb-4">
                                <span className="material-symbols-outlined text-secondary text-2xl">inventory_2</span>
                            </div>
                            <p className="text-on-surface font-semibold mb-1">No shipments added yet</p>
                            <p className="text-secondary text-sm">Add a shipment below and it will appear here.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {shipments.map((shipment) => (
                                <article
                                    key={shipment.id}
                                    className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-5 py-4"
                                >
                                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                        <p className="text-sm font-bold text-on-surface">Truck: {shipment.truckNumber}</p>
                                        <p className="text-xs text-secondary">Created: {formatDateLabel(shipment.createdAt)}</p>
                                    </div>
                                    <p className="text-sm text-on-surface mt-2">
                                        {shipment.sourceAddress} <span className="text-secondary">to</span> {shipment.destinationAddress}
                                    </p>
                                    <p className="text-xs text-secondary mt-1">
                                        Src ({formatCoordinate(shipment.sourceLat)}, {formatCoordinate(shipment.sourceLng)}) • Dst (
                                        {formatCoordinate(shipment.destLat)}, {formatCoordinate(shipment.destLng)})
                                    </p>
                                    <p className="text-xs text-secondary mt-1">Deadline: {formatDateLabel(shipment.deadline)}</p>
                                </article>
                            ))}
                        </div>
                    )}
                </div>

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
