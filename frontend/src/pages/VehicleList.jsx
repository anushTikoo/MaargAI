import { useEffect, useState } from 'react';
import { getTrucksForCurrentUser, deleteTruckForCurrentUser, updateTruckForCurrentUser } from '../services/trucksService';

export default function VehicleList() {
    const [trucks, setTrucks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');

    // Modal States
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [truckToDelete, setTruckToDelete] = useState(null);

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingTruckId, setEditingTruckId] = useState(null);
    const [editTruckNumber, setEditTruckNumber] = useState('');
    const [editTruckType, setEditTruckType] = useState('Light');
    const [editAdvancedOpen, setEditAdvancedOpen] = useState(false);

    const [editCapacity, setEditCapacity] = useState('');
    const [editHeight, setEditHeight] = useState('');
    const [editMileage, setEditMileage] = useState('');
    const [editWeight, setEditWeight] = useState('');
    const [editError, setEditError] = useState('');
    const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

    const truckTypes = [
        { id: 'Mini', icon: 'local_shipping' },
        { id: 'Light', icon: 'local_shipping' },
        { id: 'Medium', icon: 'local_shipping' },
        { id: 'Heavy', icon: 'local_shipping' },
        { id: 'Trailer', icon: 'rv_hookup' },
    ];

    const loadTrucks = async () => {
        setIsLoading(true);
        setErrorMessage('');

        try {
            const { trucks: trucksData } = await getTrucksForCurrentUser();
            setTrucks(Array.isArray(trucksData) ? trucksData : []);
        } catch (error) {
            setErrorMessage(error?.message || 'Unable to load vehicles.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        let isActive = true;

        const initLoad = async () => {
            setIsLoading(true);
            setErrorMessage('');

            try {
                const { trucks: trucksData } = await getTrucksForCurrentUser();

                if (!isActive) {
                    return;
                }

                setTrucks(Array.isArray(trucksData) ? trucksData : []);
            } catch (error) {
                if (!isActive) {
                    return;
                }

                setErrorMessage(error?.message || 'Unable to load vehicles.');
            } finally {
                if (isActive) {
                    setIsLoading(false);
                }
            }
        };

        initLoad();

        return () => {
            isActive = false;
        };
    }, []);

    // --- DELETE LOGIC ---
    const handleDeleteClick = (truck) => {
        setTruckToDelete(truck);
        setDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!truckToDelete) return;
        try {
            await deleteTruckForCurrentUser(truckToDelete.id);
            setTrucks((prev) => prev.filter((t) => String(t.id) !== String(truckToDelete.id)));
            setDeleteModalOpen(false);
            setTruckToDelete(null);
        } catch (error) {
            alert(error?.message || 'Failed to delete truck');
        }
    };

    // --- EDIT LOGIC ---
    const handleEditClick = (truck) => {
        setEditError('');
        setEditingTruckId(truck.id);
        setEditTruckNumber(truck.truck_number || '');
        setEditTruckType((truck.truck_type || 'Light').charAt(0).toUpperCase() + (truck.truck_type || 'light').slice(1));

        // Populate advanced fields
        setEditCapacity(truck.capacity_kg || '');
        setEditHeight(truck.height_m || '');
        setEditMileage(truck.mileage_kmpl || '');
        setEditWeight(truck.truck_weight || '');

        setEditAdvancedOpen(false);
        setEditModalOpen(true);
    };

    const isAdvancedComplete = [editCapacity, editHeight, editMileage, editWeight].every((value) => String(value).trim() !== '');
    const isBasicComplete = editTruckNumber.trim() !== '' && editTruckType.trim() !== '';
    const canSubmitEdit = isBasicComplete && (!editAdvancedOpen || isAdvancedComplete) && !isSubmittingEdit;

    const submitEdit = async () => {
        setEditError('');

        const normalizedTruckNumber = editTruckNumber.trim();
        if (!normalizedTruckNumber || !editTruckType.trim()) {
            setEditError('Truck number and truck type are required.');
            return;
        }

        if (editAdvancedOpen && !isAdvancedComplete) {
            setEditError('Fill all advanced specs before updating this truck.');
            return;
        }

        try {
            setIsSubmittingEdit(true);
            await updateTruckForCurrentUser(editingTruckId, {
                truckNumber: normalizedTruckNumber,
                truckType: editTruckType,
                advancedSpecs: editAdvancedOpen
                    ? {
                          capacity: editCapacity,
                          height: editHeight,
                          mileage: editMileage,
                          weight: editWeight,
                      }
                    : null,
            });
            await loadTrucks();
            setEditModalOpen(false);
        } catch (error) {
            setEditError(error?.message || 'Failed to update truck');
        } finally {
            setIsSubmittingEdit(false);
        }
    };

    const formatTruckType = (truckType) => {
        if (!truckType) {
            return 'N/A';
        }
        return truckType.charAt(0).toUpperCase() + truckType.slice(1);
    };

    const formatMetric = (value, unit) => {
        if (value === null || value === undefined || value === '') {
            return 'N/A';
        }
        const numericValue = Number(value);
        if (Number.isNaN(numericValue)) {
            return `${value} ${unit}`.trim();
        }
        return `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`.trim();
    };

    return (
        <section
            className="flex-1 bg-surface-bright p-8 md:p-12 bg-[radial-gradient(circle,#e2e2e5_1px,transparent_1px)] overflow-y-auto"
            style={{ backgroundSize: '32px 32px' }}
        >
            <div className="max-w-4xl mx-auto relative">
                <div className="mb-12 relative">
                    <h1 className="text-4xl font-black text-on-surface mb-4">Vehicle List</h1>
                    <p className="text-secondary max-w-xl text-md">
                        Manage and review the trucks currently integrated into your fleet.
                    </p>
                </div>

                {isLoading ? (
                    <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 flex flex-col items-center text-center shadow-sm">
                        <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mb-6">
                            <span className="material-symbols-outlined text-secondary text-2xl animate-pulse">progress_activity</span>
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Loading Vehicles</h3>
                        <p className="text-secondary mb-0 max-w-sm text-sm">Fetching your fleet information.</p>
                    </div>
                ) : null}

                {!isLoading && errorMessage ? (
                    <div className="bg-error-container/60 border border-red-300/70 rounded-xl p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-on-error-container mb-1">Unable to load vehicles</h3>
                        <p className="text-on-error-container/90 text-sm mb-0">{errorMessage}</p>
                    </div>
                ) : null}

                {!isLoading && !errorMessage && trucks.length === 0 ? (
                    <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 flex flex-col items-center text-center shadow-sm">
                        <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mb-6">
                            <span className="material-symbols-outlined text-secondary text-2xl">inbox</span>
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">No Vehicles Added</h3>
                        <p className="text-secondary mb-0 max-w-sm text-sm">
                            You have not added any vehicles to your fleet yet. Go to 'Add Fleet' to get started.
                        </p>
                    </div>
                ) : null}

                {!isLoading && !errorMessage && trucks.length > 0 ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-5">
                            {trucks.map((truck) => (
                                <article
                                    key={truck.id ?? truck.truck_number}
                                    className="bg-surface-container-lowest border border-outline-variant/30 hover:border-primary/50 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 relative overflow-hidden flex flex-col md:flex-row md:items-center gap-6 group"
                                >
                                    <div className="absolute top-0 left-0 w-2 h-full bg-primary/80 transition-transform origin-bottom group-hover:scale-y-110"></div>

                                    <div className="w-16 h-16 rounded-full bg-primary-container/10 shrink-0 flex items-center justify-center border border-primary/20">
                                        <span className="material-symbols-outlined text-primary text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                                            {truck.truck_type?.toLowerCase() === 'trailer' ? 'rv_hookup' : 'local_shipping'}
                                        </span>
                                    </div>

                                    <div className="flex-1 w-full">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
                                            <div className="flex flex-col gap-1">
                                                <p className="text-xs uppercase tracking-widest text-secondary font-bold">Truck Number</p>
                                                <h3 className="text-2xl font-black text-on-surface tracking-tight uppercase leading-none">
                                                    {truck.truck_number}
                                                </h3>
                                            </div>
                                            <div className="flex items-center gap-2 self-start md:self-auto">
                                                <span className="px-4 py-1.5 rounded-full bg-primary/10 text-primary-container font-black text-xs uppercase tracking-[0.15em] border border-primary/20 whitespace-nowrap truncate">
                                                    {formatTruckType(truck.truck_type)}
                                                </span>
                                                <button
                                                    onClick={() => handleEditClick(truck)}
                                                    className="p-1.5 rounded-full text-secondary hover:text-primary hover:bg-surface-container transition-colors cursor-pointer border-none bg-transparent"
                                                    title="Edit Truck Number"
                                                >
                                                    <span className="material-symbols-outlined text-xl">edit</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteClick(truck)}
                                                    className="p-1.5 rounded-full text-secondary hover:text-error hover:bg-error-container transition-colors cursor-pointer border-none bg-transparent"
                                                    title="Delete Truck"
                                                >
                                                    <span className="material-symbols-outlined text-xl">delete</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 text-secondary text-sm font-medium w-full">
                                            <div className="flex items-center gap-1.5 bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant/20 flex-1 min-w-fit md:flex-none">
                                                <span className="material-symbols-outlined text-lg text-primary opacity-80">takeout_dining</span>
                                                <span className="uppercase text-[10px] tracking-wider font-bold opacity-70">Cap:</span>
                                                <span className="text-on-surface font-bold">{formatMetric(truck.capacity_kg, 'kg')}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant/20 flex-1 min-w-fit md:flex-none">
                                                <span className="material-symbols-outlined text-lg text-primary opacity-80">height</span>
                                                <span className="uppercase text-[10px] tracking-wider font-bold opacity-70">Ht:</span>
                                                <span className="text-on-surface font-bold">{formatMetric(truck.height_m, 'm')}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant/20 flex-1 min-w-fit md:flex-none">
                                                <span className="material-symbols-outlined text-lg text-primary opacity-80">water_drop</span>
                                                <span className="uppercase text-[10px] tracking-wider font-bold opacity-70">Mil:</span>
                                                <span className="text-on-surface font-bold">{formatMetric(truck.mileage_kmpl, 'kmpl')}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant/20 flex-1 min-w-fit md:flex-none">
                                                <span className="material-symbols-outlined text-lg text-primary opacity-80">scale</span>
                                                <span className="uppercase text-[10px] tracking-wider font-bold opacity-70">Wt:</span>
                                                <span className="text-on-surface font-bold">{formatMetric(truck.truck_weight, 'kg')}</span>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            {/* DELETE MODAL */}
            {deleteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-surface-container-lowest rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
                        <div className="w-16 h-16 bg-error-container rounded-full flex items-center justify-center mb-6 mx-auto">
                            <span className="material-symbols-outlined text-on-error-container text-3xl">delete_forever</span>
                        </div>
                        <h3 className="text-2xl font-black text-center text-on-surface mb-2">Delete Vehicle?</h3>
                        <p className="text-center text-secondary mb-8">
                            Are you sure you want to delete truck <span className="font-bold text-on-surface">{truckToDelete?.truck_number}</span>? This action cannot be undone.
                        </p>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setDeleteModalOpen(false)}
                                className="flex-1 px-4 py-3 rounded-lg border-2 border-outline-variant text-secondary font-bold hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 px-4 py-3 rounded-lg bg-error text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-error/20 cursor-pointer border-none"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT MODAL */}
            {editModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-surface-container-lowest rounded-2xl p-8 max-w-2xl w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-8 border-b border-outline-variant/20 pb-4">
                            <h2 className="text-2xl font-black text-on-surface flex items-center gap-3">
                                <span className="material-symbols-outlined text-primary text-3xl">edit_document</span>
                                Edit Vehicle
                            </h2>
                            <button
                                onClick={() => setEditModalOpen(false)}
                                className="text-secondary hover:text-on-surface cursor-pointer border-none bg-transparent"
                            >
                                <span className="material-symbols-outlined text-3xl">close</span>
                            </button>
                        </div>

                        <div className="space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-black uppercase text-secondary mb-3" style={{ letterSpacing: '0.1em' }}>
                                        Truck Number
                                    </label>
                                    <input
                                        className="w-full bg-surface-container-low border-b-2 border-transparent focus:border-primary focus:bg-surface transition-all px-4 py-3 text-lg font-medium outline-none"
                                        placeholder="e.g. MH 12 AB 1234"
                                        type="text"
                                        value={editTruckNumber}
                                        onChange={(e) => setEditTruckNumber(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase text-secondary mb-4 mt-1" style={{ letterSpacing: '0.1em' }}>
                                        Truck Type
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {truckTypes.map((type) => (
                                            <button
                                                key={type.id}
                                                type="button"
                                                onClick={() => setEditTruckType(type.id)}
                                                className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-lg transition-all group active:scale-95 ${
                                                    editTruckType === type.id
                                                        ? 'bg-primary text-white shadow-sm'
                                                        : 'bg-surface-container-low border border-transparent hover:border-primary/20 text-secondary'
                                                }`}
                                            >
                                                <span className="text-[10px] font-bold uppercase tracking-tight">
                                                    {type.id}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Advanced Specs */}
                            <div className="bg-surface-container-low/50 p-6 rounded-xl border border-outline-variant/10">
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className="text-sm font-bold text-on-surface uppercase tracking-wider flex items-center gap-2">
                                        <span className="material-symbols-outlined text-secondary text-lg">tune</span> Advanced Specs
                                    </h4>
                                    <div
                                        className="relative inline-flex items-center cursor-pointer"
                                        onClick={() => setEditAdvancedOpen(!editAdvancedOpen)}
                                    >
                                        <div
                                            className={`w-11 h-6 rounded-full transition-colors border shadow-inner ${
                                                editAdvancedOpen ? 'bg-primary border-primary' : 'bg-gray-300 border-gray-400'
                                            }`}
                                        ></div>
                                        <div
                                            className="absolute bg-white w-5 h-5 rounded-full transition-all shadow-md"
                                            style={{
                                                top: '2px',
                                                left: editAdvancedOpen ? '22px' : '2px',
                                            }}
                                        ></div>
                                    </div>
                                </div>

                                <div
                                    className={`grid grid-cols-2 gap-x-6 gap-y-6 transition-all duration-300 ${
                                        editAdvancedOpen ? 'opacity-100' : 'opacity-0 max-h-0 overflow-hidden pt-0 mt-0 gap-y-0'
                                    }`}
                                    style={{ maxHeight: editAdvancedOpen ? '500px' : '0px' }}
                                >
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Capacity (kg)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            type="number"
                                            value={editCapacity}
                                            onChange={(e) => setEditCapacity(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Height (m)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            step="0.1"
                                            type="number"
                                            value={editHeight}
                                            onChange={(e) => setEditHeight(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Mileage (kmpl)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            step="0.5"
                                            type="number"
                                            value={editMileage}
                                            onChange={(e) => setEditMileage(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Truck Weight (kg)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            type="number"
                                            value={editWeight}
                                            onChange={(e) => setEditWeight(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-3 pt-8 mt-6 border-t border-outline-variant/20">
                            {editError ? <p className="text-sm text-error font-medium">{editError}</p> : null}

                            <div className="flex gap-4 w-full md:w-auto">
                                <button
                                    type="button"
                                    onClick={() => setEditModalOpen(false)}
                                    className="px-6 py-3 rounded-lg border-2 border-outline-variant text-secondary font-bold hover:bg-surface-container-low transition-colors cursor-pointer w-full md:w-auto"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={submitEdit}
                                    disabled={!canSubmitEdit}
                                    className="cursor-pointer bg-primary text-on-primary px-8 py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary-container transition-all border-none shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed w-full md:w-auto"
                                >
                                    {isSubmittingEdit ? 'Saving...' : 'Save Changes'}
                                    <span className="material-symbols-outlined text-sm">save</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
