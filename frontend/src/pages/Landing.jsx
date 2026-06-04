import { useNavigate } from 'react-router-dom';

export default function Landing() {
  const navigate = useNavigate();

  return (
     <div className="antialiased overflow-x-hidden min-h-screen flex flex-col font-inter bg-surface text-on-surface bg-[url('var(--background-image-grid-pattern)')] bg-fixed">
      {/* TopNavBar */}
      <nav className="docked full-width top-0 sticky z-50 glass no-line tonal-shift bg-surface-container-low/50 shadow-sm border-b border-outline-variant/15">
        <div className="flex justify-between items-center w-full px-6 py-4 max-w-7xl mx-auto">
          {/* Brand */}
          <a className="text-xl font-black text-primary tracking-tighter flex items-center gap-2 font-inter" href="#">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>route</span>
            MaargAI
          </a>
          {/* Navigation Links (Web) */}
          {/* Actions */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              className="hidden md:block text-on-surface-variant font-medium hover:text-primary transition-colors duration-200 font-inter tracking-tight cursor-pointer"
              onClick={() => navigate('/signup', { state: { mode: 'signin' } })}
            >
              Login
            </button>
            <button
              className="btn-primary py-1.5 px-3 sm:py-2.5 sm:px-7 rounded font-medium text-xs sm:text-sm tracking-wide hover:opacity-90 transition-opacity scale-95 active:scale-90 flex items-center gap-1 sm:gap-2 border border-white/20 cursor-pointer"
              onClick={() => navigate('/signup', { state: { mode: 'signup' } })}
            >
              <span className="hidden sm:inline">Optimize Your Fleet</span>
              <span className="sm:hidden">Optimize</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>
      </nav>
      {/* Main Content Canvas */}
      <main className="flex-grow flex flex-col items-center justify-start w-full">
        {/* Hero Section: Asymmetric & High Contrast */}
        <section className="w-full max-w-7xl mx-auto px-6 py-24 md:py-32 flex flex-col md:flex-row items-center gap-16 relative">
          {/* Text Content */}
          <div className="w-full md:w-1/2 flex flex-col items-start z-10">
            <span className="label-md text-primary mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              Live Logistics Intelligence
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl text-on-surface mb-6 font-headline font-extrabold tracking-tight leading-tight">
              The Digital Wayfinder for Indian Logistics.
            </h1>
            <p className="text-lg md:text-xl text-on-surface-variant font-body mb-10 leading-relaxed max-w-xl">
              Stop reacting to delays. Start predicting them. Our AI-powered system proactively detects traffic, weather, and bottlenecks to keep your fleet moving efficiently across the subcontinent.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <button
                className="bg-primary text-on-primary px-10 py-5 rounded-lg font-extrabold text-lg tracking-wider hover:brightness-110 transition-all shadow-xl flex items-center justify-center gap-3 transform hover:scale-105 cursor-pointer"
                onClick={() => navigate('/signup', { state: { mode: 'signup' } })}
              >
                Optimize Your Fleet
                <span className="material-symbols-outlined">rocket_launch</span>
              </button>
              <button className="px-8 py-4 rounded font-semibold text-base tracking-wide bg-surface-container-highest text-on-surface hover:bg-surface-variant transition-colors flex items-center justify-center gap-2 cursor-pointer">
                View Demo
                <span className="material-symbols-outlined">play_circle</span>
              </button>
            </div>
          </div>
          {/* Visual Context: Layered Cards instead of a single image */}
          <div className="w-full md:w-1/2 relative min-h-[500px]">
            {/* Base Image Layer */}
            <div className="absolute inset-0 rounded-xl overflow-hidden shadow-lg border border-outline-variant/15 mix-blend-multiply bg-surface-container-low bg-transparent">
              <img alt="Indian Truck on Highway" className="w-full h-full object-cover" data-alt="Modern Indian commercial truck driving on a multi-lane highway at sunset, desaturated slightly with cinematic lighting, showcasing professional logistics operations" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAY5325LwpNKGv9KcBq9wVPxlYwuU7V1b61wco4-xjJ29xq6eFlm6ehnE2VlMqbzPmMwtVM7R12hD5C_ZeskIoxsklBor874ALSsskrWB-axwO1Io-cYoMu6LwEd4pa8fyUhoQJU7rOE8VKUtr3IWyUuSH4_Z8bxzMLJqa-Y0V5W3bwm_AG0u5Ulj4pKS_qDRIarycIGdksRFJ6lS3-hCtIko4JWuUveIgJP2yDAzlEhQtgMwE4sGw0aHnw2ju527AGHmTd8b9Tfk4" />
            </div>
            {/* Floating Data Card 1: Risk Score */}
            <div className="absolute top-4 sm:top-12 left-2 sm:-left-8 md:-left-12 w-48 sm:w-64 bg-surface-container-lowest p-3 sm:p-5 rounded-lg ambient-shadow border border-outline-variant/15 flex flex-col gap-2 sm:gap-3">
              <div className="flex justify-between items-center">
                <span className="label-md text-[10px] sm:text-xs text-on-surface-variant">Route NH44</span>
                <span className="material-symbols-outlined text-primary text-sm sm:text-base" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
              </div>
              <div className="flex items-end gap-1 sm:gap-2">
                <span className="text-xl sm:text-3xl font-headline font-bold text-on-surface">Risk: High</span>
              </div>
              <div className="h-1 sm:h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
                <div className="h-full bg-primary w-3/4"></div>
              </div>
              <p className="text-[10px] sm:text-xs text-on-surface-variant leading-tight">Monsoon washout detected near Nagpur. Rerouting...</p>
            </div>
            {/* Floating Data Card 2: AI Optimization */}
            <div className="absolute bottom-4 sm:bottom-16 right-4 sm:right-6 md:right-8 lg:right-12 w-56 sm:w-72 bg-surface-container-lowest p-3 sm:p-5 rounded-lg ambient-shadow border border-outline-variant/15 flex flex-col gap-2 sm:gap-4">
              <div className="flex justify-between items-center">
                <span className="label-md text-[10px] sm:text-xs text-secondary">AI Recommendation</span>
                <span className="material-symbols-outlined text-secondary text-sm sm:text-base" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
              </div>
              <div className="p-2 sm:p-3 bg-secondary-fixed rounded flex items-start gap-2 sm:gap-3">
                <span className="material-symbols-outlined text-on-secondary-fixed-variant mt-0.5 text-sm sm:text-base">alt_route</span>
                <div>
                  <p className="text-xs sm:text-sm font-semibold text-on-secondary-fixed-variant">Take State Highway 15</p>
                  <p className="text-[10px] sm:text-xs text-on-secondary-fixed-variant/80 mt-0.5 sm:mt-1">Saves 4 hours &amp; 12% Fuel</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* How it Works Section: Vertical Tonal Layering */}
        <section className="w-full bg-surface-container-low py-24 relative overflow-hidden">
          {/* Background Texture */}
          <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(var(--color-on-surface) 1px, transparent 1px)", backgroundSize: "40px 40px" }}></div>
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="mb-16 flex flex-col items-center text-center">
              <h2 className="text-3xl md:text-4xl text-on-surface font-headline font-bold mb-4">Intelligence at Every Mile</h2>
              <p className="text-lg text-on-surface-variant max-w-2xl">A seamless workflow designed for the reality of Indian long-haul logistics. From dispatch to destination.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 lg:gap-16">
              {/* Step 1 */}
              <div className="flex flex-col relative group bg-white p-8 rounded-2xl shadow-2xl border-2 border-slate-300 hover:border-slate-400 hover:-translate-y-2 transition-all duration-300">
                <div className="w-16 h-16 rounded-xl bg-surface-container-low shadow-sm flex items-center justify-center mb-6 relative z-10 border border-outline-variant/15 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-3xl text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>add_location_alt</span>
                </div>
                <h3 className="text-2xl font-bold text-on-surface mb-3">1. Create &amp; Track</h3>
                <p className="text-on-surface-variant leading-relaxed">Fleet managers set trips in seconds. Drivers simply downloads the constracker app, enters license plate number and start tracking.</p>
              </div>
              {/* Step 2 */}
              <div className="flex flex-col relative group bg-white p-8 rounded-2xl shadow-2xl border-2 border-slate-300 hover:border-slate-400 hover:-translate-y-2 transition-all duration-300">
                <div className="w-16 h-16 rounded-xl bg-surface-container-low shadow-sm flex items-center justify-center mb-6 relative z-10 border border-outline-variant/15 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-3xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>monitoring</span>
                </div>
                <h3 className="text-2xl font-bold text-on-surface mb-3">2. Analyze &amp; Monitor</h3>
                <p className="text-on-surface-variant leading-relaxed">We ingest real-time Google Maps telemetry and cross-reference it with localized weather and regional unrest data to calculate a live Risk Score.</p>
              </div>
              {/* Step 3 */}
              <div className="flex flex-col relative group bg-white p-8 rounded-2xl shadow-2xl border-2 border-slate-300 hover:border-slate-400 hover:-translate-y-2 transition-all duration-300">
                <div className="w-16 h-16 rounded-xl bg-surface-container-low shadow-sm flex items-center justify-center mb-6 relative z-10 border border-outline-variant/15 group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-3xl text-tertiary-container" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
                </div>
                <h3 className="text-2xl font-bold text-on-surface mb-3">3. AI Optimization</h3>
                <p className="text-on-surface-variant leading-relaxed">Our Gemini-powered engine contextualizes delays and instantly recommends dynamic rerouting options to preserve fuel, time, and margins.</p>
              </div>
            </div>
          </div>
        </section>
        {/* Features: Bento Grid Style */}
        <section className="w-full max-w-7xl mx-auto px-6 py-24">
          <div className="mb-16">
            <h2 className="text-3xl md:text-4xl text-on-surface font-headline font-bold mb-4">Built for the Bottom Line</h2>
            <p className="text-lg text-on-surface-variant max-w-2xl">We don't just show you dots on a map. We provide actionable intelligence that directly impacts profitability.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min">
            {/* Feature 1: Large Card */}
            <div className="col-span-1 md:col-span-2 lg:col-span-2 bg-white rounded-2xl p-8 lg:p-12 shadow-2xl border-2 border-slate-300 hover:border-slate-400 hover:-translate-y-2 transition-all duration-300 flex flex-col justify-between overflow-hidden relative group">
              <div className="relative z-10 max-w-md">
                <span className="material-symbols-outlined text-4xl text-primary mb-6 transition-transform group-hover:scale-110" style={{ fontVariationSettings: "'FILL' 1" }}>local_gas_station</span>
                <h3 className="text-2xl font-bold text-on-surface mb-4">Fuel Savings at Scale</h3>
                <p className="text-on-surface-variant text-lg">Idling in unpredicted traffic jams burns margins. Our predictive rerouting helps fleets avoid bottlenecks entirely, resulting in up to 15% reduction in overall fuel consumption across top Indian corridors.</p>
              </div>
              {/* Decorative Element */}
              <div className="absolute -bottom-10 -right-10 opacity-10 transition-transform group-hover:scale-105 group-hover:opacity-20 duration-500">
                <span className="material-symbols-outlined" style={{ fontSize: "300px", fontVariationSettings: "'FILL' 1" }}>savings</span>
              </div>
            </div>
            {/* Feature 2: Tall Card */}
            <div className="col-span-1 bg-white rounded-2xl p-8 shadow-2xl border-2 border-slate-300 hover:border-slate-400 hover:-translate-y-2 transition-all duration-300 flex flex-col group">
              <span className="material-symbols-outlined text-4xl text-secondary mb-6 transition-transform group-hover:scale-101" style={{ fontVariationSettings: "'FILL' 1" }}>security</span>
              <h3 className="text-xl font-bold text-on-surface mb-4">Proactive Risk Mitigation</h3>
              <p className="text-on-surface-variant flex-grow">From sudden state border closures to monsoon flooding, we alert you before your vehicle gets stuck. Protect your assets and ensure driver safety with localized, real-time alerts.</p>
              <div className="mt-8 p-4 bg-surface-container-lowest rounded border border-outline-variant/15 transition-colors group-hover:bg-surface-container-low">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-error"></span>
                  <span className="text-sm font-semibold text-on-surface">Alert: NH8 Blockade</span>
                </div>
                <p className="text-xs text-on-surface-variant">Expected delay: 4+ hrs. Reroute advised.</p>
              </div>
            </div>
            {/* Feature 3: Standard Card */}
            <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-secondary text-on-secondary rounded-2xl p-8 lg:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl border-2 border-slate-400 hover:border-white/50 hover:-translate-y-2 transition-all duration-300 group">
              <div className="max-w-2xl">
                <h3 className="text-2xl font-bold mb-4">Real-time Reliability</h3>
                <p className="text-on-secondary/80 text-lg">Stop relying on outdated manual check-ins. Provide your end-customers with precise, AI-backed ETAs that build trust and win repeat business in a highly competitive market.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      {/* Footer Component */}
      <footer className="full-width py-12 flex-shrink-0 border-t border-outline-variant/15 bg-surface-container-low mt-auto">
        <div className="flex flex-col md:flex-row justify-between items-center px-8 max-w-7xl mx-auto gap-6 md:gap-0">
          {/* Brand & Copyright */}
          <div className="flex flex-col items-center md:items-start gap-2">
            <span className="text-lg font-bold text-on-surface flex items-center gap-2 font-inter">
              <span className="material-symbols-outlined">route</span>
              MaargAI
            </span>
            <p className="text-sm font-inter text-on-surface-variant">© 2026 MaargAI Logistics.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
