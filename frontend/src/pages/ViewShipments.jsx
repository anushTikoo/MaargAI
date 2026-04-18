import React from 'react';

export default function ViewShipments() {
    return (
        <section
            className="flex-1 bg-surface-bright p-8 md:p-12 bg-[radial-gradient(circle,#e2e2e5_1px,transparent_1px)] overflow-y-auto"
            style={{ backgroundSize: '32px 32px' }}
        >
            <div className="max-w-4xl mx-auto">
                <div className="mb-12 relative">
                    <h1 className="text-4xl font-black text-on-surface mb-4">View Shipments</h1>
                    <p className="text-secondary max-w-xl text-md">
                        Track and monitor active and past shipments in the routing network.
                    </p>
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 flex flex-col items-center text-center shadow-sm">
                    <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mb-6">
                        <span className="material-symbols-outlined text-secondary text-2xl">inventory_2</span>
                    </div>
                    <h3 className="text-lg font-bold text-on-surface mb-2">No Shipments</h3>
                    <p className="text-secondary mb-0 max-w-sm text-sm">
                        There are currently no shipments to display. Create a new shipment to start tracking.
                    </p>
                </div>
            </div>
        </section>
    );
}
