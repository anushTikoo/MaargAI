import { useRef, useState } from 'react';
import { addTruckForCurrentUser } from '../services/trucksService';

export default function FleetInfo() {
    // Form states
    const [truckNumber, setTruckNumber] = useState('');
    const [truckType, setTruckType] = useState('Light');
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // Spec states
    const [capacity, setCapacity] = useState('');
    const [height, setHeight] = useState('');
    const [mileage, setMileage] = useState('');
    const [weight, setWeight] = useState('');
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fileInputRef = useRef(null);

    const handleFileSelect = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            console.log('File selected:', file.name);
            // File handling logic goes here
        }
    };

    const isAdvancedComplete = [capacity, height, mileage, weight].every((value) => String(value).trim() !== '');
    const isBasicComplete = truckNumber.trim() !== '' && truckType.trim() !== '';
    const canSubmit = isBasicComplete && (!advancedOpen || isAdvancedComplete) && !isSubmitting;

    const handleAddToFleet = async () => {
        setFormError('');
        setFormSuccess('');

        const normalizedTruckNumber = truckNumber.trim();

        if (!normalizedTruckNumber || !truckType.trim()) {
            setFormError('Truck number and truck type are required.');
            return;
        }

        if (advancedOpen && !isAdvancedComplete) {
            setFormError('Fill all advanced specs before adding this truck.');
            return;
        }

        try {
            setIsSubmitting(true);

            const addedTruck = await addTruckForCurrentUser({
                truckNumber: normalizedTruckNumber,
                truckType,
                advancedSpecs: advancedOpen
                    ? {
                          capacity,
                          height,
                          mileage,
                          weight,
                      }
                    : null,
            });

            setFormSuccess(`Truck ${addedTruck.truck_number || normalizedTruckNumber} was added to your fleet.`);
            setTruckNumber('');
            setTruckType('Light');
            setCapacity('');
            setHeight('');
            setMileage('');
            setWeight('');
            setAdvancedOpen(false);
        } catch (error) {
            setFormError(error?.message || 'Unable to add truck to fleet.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const truckTypes = [
        { id: 'Mini', icon: 'local_shipping' },
        { id: 'Light', icon: 'local_shipping' },
        { id: 'Medium', icon: 'local_shipping' },
        { id: 'Heavy', icon: 'local_shipping' },
        { id: 'Trailer', icon: 'rv_hookup' },
    ];

    return (
        <section
            className="flex-1 bg-surface-bright p-8 md:p-12 bg-[radial-gradient(circle,#e2e2e5_1px,transparent_1px)] overflow-y-auto"
            style={{ backgroundSize: '32px 32px' }}
        >
            <div className="max-w-4xl mx-auto">
                {/* Hero Section / Title */}
                <div className="mb-12 relative">
                    <h1 className="text-4xl font-black text-on-surface mb-4">Add Fleet Info</h1>
                    <p className="text-secondary max-w-xl text-md">
                        Scale your logistics operations by integrating new vehicles into the MaargAI neural routing network.
                    </p>
                    {/* Decorative Element */}
                    <div className="absolute -top-10 -right-10 opacity-10 pointer-events-none hidden md:block">
                        <img
                            alt="Logistics background"
                            className="w-64 h-64 object-contain"
                            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBISqpjv88JBvJ9MK1yd9MhifFGyEX1A7dpSn3dDiXqGsZxfGDOfgki00amZQIrNXZFXkEa8qWgeqDiGLuyfaCOMkxcMIIm9IVYM4pKqEJbldlYzO0RkdmV-6CX0QMrKNpQ6jD6uE-C4zo3M3MrEaD3bBqcZ7vlrDFEngg9kQCnNAvCECcGnwjunW-WXroOCedGdi01GRkshgmoJtwtj543F3TkNf42ewWsi0SFM6F1kcv4Dh56e1GsCgRvTV_8iHqfsZHyL-y308o"
                        />
                    </div>
                </div>

                {/* Excel Upload Section */}
                <div className="mb-16">
                    <div className="bg-surface-container-lowest border-2 border-dashed border-outline-variant/30 rounded-xl p-10 flex flex-col items-center text-center transition-all hover:border-primary/40 group">
                        <div className="w-16 h-16 bg-primary-fixed rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                            <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                                upload_file
                            </span>
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Excel Upload for Bulk Addition</h3>
                        <p className="text-secondary mb-8 max-w-sm text-sm">
                            Drag and drop your fleet manifest here. MaargAI will automatically parse truck numbers, types, and specifications.
                        </p>

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".xlsx,.csv"
                            className="hidden"
                        />

                        <button
                            onClick={handleFileSelect}
                            className="cursor-pointer bg-primary text-on-primary px-8 py-3 rounded-lg font-bold flex items-center gap-2 hover:bg-primary-container transition-all border-none shadow-lg shadow-primary/10 active:scale-95"
                        >
                            Select File <span className="material-symbols-outlined">attachment</span>
                        </button>
                        <p className="mt-4 text-xs text-secondary/60 font-['Inter'] label-md uppercase tracking-[0.05em]">
                            Supported formats: .XLSX, .CSV
                        </p>
                    </div>
                </div>

                {/* Manual Entry Section */}
                <div className="space-y-12">
                    <div className="border-b border-outline-variant/20 pb-4">
                        <h2 className="text-xl font-bold text-on-surface flex items-center gap-3">Manual Entry</h2>
                    </div>

                    {/* Single Truck Entry Form */}
                    <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/10 relative overflow-hidden">
                        {/* Card Accent */}
                        <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            {/* Basic Info */}
                            <div className="space-y-8">
                                <div>
                                    <label className="block text-xs font-black uppercase text-secondary mb-3" style={{ letterSpacing: '0.1em' }}>
                                        Truck Number
                                    </label>
                                    <input
                                        className="w-full bg-surface-container-low border-b-2 border-transparent focus:border-primary focus:bg-surface transition-all px-4 py-3 text-lg font-medium outline-none"
                                        placeholder="e.g. MH 12 AB 1234"
                                        type="text"
                                        value={truckNumber}
                                        onChange={(e) => setTruckNumber(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black uppercase text-secondary mb-4" style={{ letterSpacing: '0.1em' }}>
                                        Truck Type
                                    </label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {truckTypes.map((type) => (
                                            <button
                                                key={type.id}
                                                type="button"
                                                onClick={() => setTruckType(type.id)}
                                                className={`cursor-pointer flex flex-col items-center justify-center p-4 rounded-lg transition-all group active:scale-95 ${
                                                    truckType === type.id
                                                        ? 'bg-white border-2 border-primary shadow-sm scale-105 z-10'
                                                        : 'bg-surface-container-low border-2 border-transparent hover:border-primary/20'
                                                }`}
                                            >
                                                <span
                                                    className={`material-symbols-outlined text-3xl mb-2 transition-colors ${
                                                        truckType === type.id ? 'text-primary' : 'text-secondary group-hover:text-primary'
                                                    }`}
                                                    style={truckType === type.id ? { fontVariationSettings: "'FILL' 1" } : {}}
                                                >
                                                    {type.icon}
                                                </span>
                                                <span
                                                    className={`text-[10px] font-bold uppercase tracking-tight ${
                                                        truckType === type.id ? 'text-primary font-black' : ''
                                                    }`}
                                                >
                                                    {type.id}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Advanced Specs */}
                            <div className="bg-surface-container-low/50 p-6 rounded-xl border border-outline-variant/10">
                                <div className="flex items-center justify-between mb-6">
                                    <h4 className="text-sm font-bold text-on-surface uppercase tracking-wider flex items-center gap-2">
                                        <span className="material-symbols-outlined text-secondary text-lg">tune</span> Advanced Specs
                                    </h4>
                                    <div
                                        className="relative inline-flex items-center cursor-pointer"
                                        onClick={() => setAdvancedOpen(!advancedOpen)}
                                    >
                                        <div
                                            className={`w-11 h-6 rounded-full transition-colors border shadow-inner ${
                                                advancedOpen ? 'bg-primary border-primary' : 'bg-gray-300 border-gray-400'
                                            }`}
                                        ></div>
                                        <div
                                            className="absolute bg-white w-5 h-5 rounded-full transition-all shadow-md"
                                            style={{
                                                top: '2px',
                                                left: advancedOpen ? '22px' : '2px',
                                            }}
                                        ></div>
                                    </div>
                                </div>

                                <div
                                    className={`grid grid-cols-2 gap-x-6 gap-y-6 transition-all duration-300 ${
                                        advancedOpen ? 'opacity-100' : 'opacity-0 max-h-0 overflow-hidden pt-0 mt-0 gap-y-0'
                                    }`}
                                    style={{ maxHeight: advancedOpen ? '500px' : '0px' }}
                                >
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Capacity (kg)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            type="number"
                                            value={capacity}
                                            onChange={(e) => setCapacity(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Height (m)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            step="0.1"
                                            type="number"
                                            value={height}
                                            onChange={(e) => setHeight(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Mileage (kmpl)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            step="0.5"
                                            type="number"
                                            value={mileage}
                                            onChange={(e) => setMileage(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase text-secondary mb-1">Truck Weight (kg)</label>
                                        <input
                                            className="w-full bg-surface-container-lowest border-none px-3 py-2 text-sm font-medium focus:ring-1 focus:ring-primary outline-none rounded"
                                            type="number"
                                            value={weight}
                                            onChange={(e) => setWeight(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Primary Action */}
                <div className="flex flex-col items-end gap-3 pt-8">
                    {formError ? <p className="text-sm text-error font-medium">{formError}</p> : null}
                    {formSuccess ? <p className="text-sm text-green-700 font-medium">{formSuccess}</p> : null}

                    <button
                        type="button"
                        onClick={handleAddToFleet}
                        disabled={!canSubmit}
                        className="cursor-pointer bg-primary text-on-primary px-12 py-5 rounded-lg text-lg font-black tracking-tight flex items-center gap-3 hover:bg-primary-container transition-all shadow-xl shadow-primary/20 active:scale-95 group border-none disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                    >
                        {isSubmitting ? 'Adding...' : 'Add to Fleet'}
                        <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
                    </button>
                </div>
            </div>
        </section>
    );
}