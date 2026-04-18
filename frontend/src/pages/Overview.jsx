export default function Overview() {
    return (
        <section
            className="flex-1 bg-surface-bright p-8 md:p-12 bg-[radial-gradient(circle,#e2e2e5_1px,transparent_1px)] overflow-y-auto"
            style={{ backgroundSize: '32px 32px' }}
        >
            <div className="max-w-4xl mx-auto">
                <div className="mb-12 relative">
                    <h1 className="text-4xl font-black text-on-surface tracking-tighter mb-4">Overview</h1>
                    <p className="text-secondary max-w-xl text-md">
                        A quick glance at your fleet operations and active trips.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Trucks Overview Card */}
                    <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/20 flex flex-col items-center justify-center text-center h-64">
                        <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mb-4 text-secondary">
                            <span className="material-symbols-outlined text-2xl">local_shipping</span>
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Trucks Added</h3>
                        <p className="text-secondary font-medium text-sm">No trucks added.</p>
                    </div>

                    {/* Trips Overview Card */}
                    <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/20 flex flex-col items-center justify-center text-center h-64">
                        <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mb-4 text-secondary">
                            <span className="material-symbols-outlined text-2xl">route</span>
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Active Trips</h3>
                        <p className="text-secondary font-medium text-sm">No trips added.</p>
                    </div>
                </div>
            </div>
        </section>
    );
}
