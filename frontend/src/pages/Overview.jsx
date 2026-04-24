import { useRef, useEffect } from 'react';

export default function Overview() {
    const mapRef = useRef(null);

    useEffect(() => {
        // Initialize the map once the component mounts and google is available
        if (mapRef.current && window.google) {
            new window.google.maps.Map(mapRef.current, {
                center: { lat: 20.5937, lng: 78.9629 }, // Center of India
                zoom: 5,
                mapId: 'DEMO_MAP_ID', // Optional: for advanced styling later
                disableDefaultUI: true, // Clean map for dashboard
                zoomControl: true,
            });
        }
    }, []);

    return (
        <section className="flex-1 p-4 bg-surface-container-low h-[calc(100vh-64px)] overflow-hidden">
            {/* Map Canvas - Contained UI Element */}
            <div className="w-full h-full relative rounded-2xl overflow-hidden border border-outline-variant/30 shadow-sm shadow-black/5 bg-white">
                {/* Map Container - Base Layer */}
                <div 
                    id="map-container" 
                    ref={mapRef} 
                    className="absolute inset-0 w-full h-full z-0"
                ></div>

                {/* Floating Panel Overlay */}
                <div className="absolute top-4 left-4 right-4 md:top-6 md:right-6 md:left-auto z-10 w-full md:max-w-[320px] p-0 pointer-events-none">
                    <div className="flex flex-row md:flex-col gap-3 md:gap-4 pointer-events-auto overflow-x-auto no-scrollbar pb-2 md:pb-0">
                        {/* Trucks Overview Card */}
                        <div className="flex-1 min-w-[160px] bg-white/95 backdrop-blur-md p-4 md:p-6 rounded-xl md:rounded-2xl shadow-xl shadow-black/10 border border-white/20 flex flex-row md:flex-col items-center justify-center md:justify-center text-center gap-3 md:gap-0 transition-all hover:translate-y-[-2px]">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-surface-container-low rounded-full flex items-center justify-center md:mb-3 text-secondary shrink-0">
                                <span className="material-symbols-outlined text-lg md:text-xl">local_shipping</span>
                            </div>
                            <div>
                                <h3 className="text-xs md:text-md font-bold text-on-surface md:mb-1 whitespace-nowrap">Trucks Added</h3>
                                <p className="text-secondary font-medium text-[10px] md:text-xs">No trucks added.</p>
                            </div>
                        </div>

                        {/* Trips Overview Card */}
                        <div className="flex-1 min-w-[160px] bg-white/95 backdrop-blur-md p-4 md:p-6 rounded-xl md:rounded-2xl shadow-xl shadow-black/10 border border-white/20 flex flex-row md:flex-col items-center justify-center md:justify-center text-center gap-3 md:gap-0 transition-all hover:translate-y-[-2px]">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-surface-container-low rounded-full flex items-center justify-center md:mb-3 text-secondary shrink-0">
                                <span className="material-symbols-outlined text-lg md:text-xl">route</span>
                            </div>
                            <div>
                                <h3 className="text-xs md:text-md font-bold text-on-surface md:mb-1 whitespace-nowrap">Active Trips</h3>
                                <p className="text-secondary font-medium text-[10px] md:text-xs">No trips added.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
