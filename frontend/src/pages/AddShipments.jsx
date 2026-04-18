import React from 'react';

export default function AddShipments() {
    return (
        <section
            className="flex-1 bg-surface-bright p-8 md:p-12 bg-[radial-gradient(circle,#e2e2e5_1px,transparent_1px)] overflow-y-auto"
            style={{ backgroundSize: '32px 32px' }}
        >
            <div className="max-w-4xl mx-auto">
                <div className="mb-12 relative">
                    <h1 className="text-4xl font-black text-on-surface mb-4">Add Shipments</h1>
                    <p className="text-secondary max-w-xl text-md">
                        Create new shipments and assign them to your available fleet.
                    </p>
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-10 flex flex-col items-center text-center shadow-sm">
                    <div className="w-16 h-16 bg-surface-container-low rounded-full flex items-center justify-center mb-6">
                        <span className="material-symbols-outlined text-secondary text-2xl">add_shopping_cart</span>
                    </div>
                    <h3 className="text-lg font-bold text-on-surface mb-2">Ready to Ship</h3>
                    <p className="text-secondary mb-0 max-w-sm text-sm">
                        Shipment form goes here. You can add origin, destination, and payload details.
                    </p>
                </div>
            </div>
        </section>
    );
}
