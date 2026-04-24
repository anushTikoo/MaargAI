import { Link, useNavigate, Outlet, useLocation } from 'react-router-dom';
import { logout } from '../services/authService';

export default function Home() {
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout().finally(() => {
            navigate('/signup', { replace: true });
        });
    };

    const isActive = (path) => location.pathname === path;

    return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col font-['Inter']">
            {/* TopAppBar */}
            <header className="bg-[#f9f9fc]/80 backdrop-blur-xl docked full-width top-0 sticky z-50 shadow-sm shadow-black/5 border-b border-surface-container">
                <div className="flex justify-between items-center px-8 py-4 max-w-360 mx-auto">
                    <Link to="/" className="cursor-pointer text-xl font-black tracking-tighter text-primary flex items-center gap-2">
                        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                            route
                        </span>
                        <span className="font-['Inter'] tracking-tight headline-sm font-bold">MaargAI</span>
                    </Link>
                    <div className="flex items-center gap-4">
                        <button className="cursor-pointer p-2 hover:bg-surface-container-low rounded-md transition-all scale-95 active:scale-90 duration-200 border-none bg-transparent">
                            <span className="material-symbols-outlined text-secondary">notifications</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 flex relative">
                {/* SideNavBar */}
                <aside className="hidden md:flex h-screen w-56 sticky top-18 bg-surface-container-low flex-col py-8 z-40">
                    <nav className="flex flex-col gap-1 pr-4">
                        <Link className={`cursor-pointer py-3 px-6 flex items-center gap-3 hover:translate-x-1 transition-transform duration-200 font-['Inter'] text-[0.7rem] uppercase tracking-[0.05em] ${isActive('/dashboard') ? 'bg-white text-primary font-bold shadow-sm rounded-r-full' : 'text-secondary'}`} to="/dashboard">
                            <span className="material-symbols-outlined text-[1.2rem]">dashboard</span> Dashboard
                        </Link>
                        <Link className={`cursor-pointer py-3 px-6 flex items-center gap-3 hover:translate-x-1 transition-transform duration-200 font-['Inter'] text-[0.7rem] uppercase tracking-[0.05em] ${isActive('/vehicle-list') ? 'bg-white text-primary font-bold shadow-sm rounded-r-full' : 'text-secondary'}`} to="/vehicle-list">
                            <span className="material-symbols-outlined text-[1.2rem]">local_shipping</span> Vehicle List
                        </Link>
                        <Link className={`cursor-pointer py-3 px-6 flex items-center gap-3 hover:translate-x-1 transition-transform duration-200 font-['Inter'] text-[0.7rem] uppercase tracking-[0.05em] ${isActive('/fleet-info') ? 'bg-white text-primary font-bold shadow-sm rounded-r-full' : 'text-secondary'}`} to="/fleet-info">
                            <span className="material-symbols-outlined text-[1.2rem]" style={isActive('/fleet-info') ? { fontVariationSettings: "'FILL' 1" } : {}}>
                                add_box
                            </span>{' '}
                            Add Fleet
                        </Link>
                        <Link className={`cursor-pointer py-3 px-6 flex items-center gap-3 hover:translate-x-1 transition-transform duration-200 font-['Inter'] text-[0.7rem] uppercase tracking-[0.05em] ${isActive('/shipments') ? 'bg-white text-primary font-bold shadow-sm rounded-r-full' : 'text-secondary'}`} to="/shipments">
                            <span className="material-symbols-outlined text-[1.2rem]" style={isActive('/shipments') ? { fontVariationSettings: "'FILL' 1" } : {}}>
                                inventory_2
                            </span>{' '}
                            Shipments
                        </Link>
                    </nav>
                    <div className="mt-auto px-6 py-8 border-t border-outline-variant/15 flex flex-col gap-4">
                        <button onClick={handleLogout} className="cursor-pointer w-full flex items-center gap-3 text-secondary text-xs font-medium hover:text-primary transition-colors bg-transparent border-none">
                            <span className="material-symbols-outlined text-lg">logout</span> Logout
                        </button>
                    </div>
                </aside>

                {/* Content Canvas (Routed via Outlet) */}
                <Outlet />

            </main>

            {/* Footer */}
            <footer className="bg-[#f9f9fc] dark:bg-slate-950 w-full mt-auto border-t border-surface-container-low dark:border-slate-800 relative z-50">
                <div className="flex flex-col md:flex-row justify-between items-center px-12 py-8 w-full max-w-360 mx-auto">
                    <div className="text-secondary dark:text-slate-400 font-['Inter'] text-[0.75rem] tracking-wide mb-4 md:mb-0">
                        © 2026 MaargAI Logistics.
                    </div>
                </div>
            </footer>
        </div>
    );
}
