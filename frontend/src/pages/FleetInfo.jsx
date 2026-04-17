export default function FleetInfo() {
    return (
        <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-surface text-on-surface bg-[url('var(--background-image-grid-pattern)')] bg-fixed overflow-hidden sm:h-screen">
            <h1 className="text-4xl font-bold mb-6">Welcome to Your Dashboard</h1>
            <p className="text-lg text-on-surface-variant mb-4">This is where you can manage your fleet and view insights.</p>
            <div className="w-full max-w-2xl bg-surface/85 backdrop-blur-[20px] rounded-lg shadow-2xl overflow-hidden border border-outline-variant/20 p-6">
                <h2 className="font-headline font-bold text-2xl tracking-tight text-on-surface mb-4">Fleet Overview</h2>
                <p className="text-on-surface-variant mb-6">Here you can see a summary of your fleet's performance and status.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                    <div className="bg-surface-container-lowest rounded-lg p-4 border border-outline-variant/15">
                        <h3 className="text-lg font-semibold text-on-surface mb-2">Active Vehicles</h3>
                        <p className="text-on-surface-variant text-sm">12 vehicles currently active on the road.</p>
                    </div>
                    <div className="bg-surface-container-lowest rounded-lg p-4 border border-outline-variant/15">
                        <h3 className="text-lg font-semibold text-on-surface mb-2">Alerts</h3>
                        <p className="text-on-surface-variant text-sm">3 new alerts for potential route disruptions.</p>
                    </div>
                    <div className="bg-surface-container-lowest rounded-lg p-4 border border-outline-variant/15">
                        <h3 className="text-lg font-semibold text-on-surface mb-2">Fuel Efficiency</h3>
                        <p className="text-on-surface-variant text-sm">Average fuel efficiency across all vehicles is 8.5 km/l.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}