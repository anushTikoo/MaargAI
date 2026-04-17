import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';

export default function Signup() {
  const location = useLocation();
  const navigate = useNavigate();

  function getGoogleErrorMessage(oauthError) {
    switch (oauthError) {
      case 'access_denied':
        return 'Google sign-in was canceled. Please try again.';
      case 'missing_code':
        return 'Google could not complete sign in. Please try again.';
      case 'server_error':
        return 'Google sign-in failed. Please try again.';
      default:
        return 'Google sign-in failed. Please try again.';
    }
  }

  const [isLogin, setIsLogin] = useState(() => {
    const searchParams = new URLSearchParams(location.search);

    return location.state?.mode === 'signin' || searchParams.get('mode') === 'signin';
  });
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => {
    const searchParams = new URLSearchParams(location.search);
    const oauthError = searchParams.get('error');

    return oauthError ? getGoogleErrorMessage(oauthError) : '';
  });
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

  const getFriendlyErrorMessage = (authenticationError) => {
    const message = authenticationError?.message || '';

    if (authenticationError instanceof TypeError || /fetch/i.test(message)) {
      return 'An error occurred. Please try again.';
    }

    return message || 'An error occurred. Please try again.';
  };

  useEffect(() => {
    if (!error) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setError('');
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [error]);

  const handleGoogleSignIn = () => {
    setError('');
    setStatus('');

    window.location.assign(`${apiBaseUrl}/api/auth/google`);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Unable to complete authentication.');
      }

      setStatus(data?.message || (isLogin ? 'Signed in successfully.' : 'Signed up successfully.'));
      navigate('/fleet-info', {
        replace: true,
        state: { user: data.user },
      });
    } catch (authenticationError) {
      setError(getFriendlyErrorMessage(authenticationError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-surface text-on-surface bg-[url('var(--background-image-grid-pattern)')] bg-fixed overflow-hidden sm:h-screen">
      {error ? (
        <div className="fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-base">error</span>
            <p className="font-body leading-5">{error}</p>
          </div>
        </div>
      ) : null}

      {/* Main Container */}
      <main className="w-full max-w-md relative z-10">
        {/* Branding Header */}
        <div className="text-center mb-6">
          <Link className="text-xl font-black text-primary tracking-tighter flex items-center justify-center gap-2 font-inter" to="/">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>route</span>
            MaargAI
          </Link>
        </div>

        {/* Auth Card */}
        <div className="bg-surface/85 backdrop-blur-[20px] rounded-lg shadow-2xl overflow-hidden border border-outline-variant/20">
          <div className="p-6">
            <h2 className="font-headline font-bold text-2xl tracking-tight text-on-surface mb-6 text-center sm:text-left">
              {isLogin ? 'Sign In' : 'Sign Up'}
            </h2>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="min-h-5 text-sm">
                {status ? <p className="text-green-700">{status}</p> : null}
              </div>
              {/* Email Field */}
              <div className="group">
                <label className="block font-label text-xs font-semibold tracking-[0.05em] uppercase text-on-surface-variant mb-2" htmlFor="email">Email Address</label>
                <div className="relative bg-surface-container-lowest border-b-2 border-transparent transition-colors duration-200 focus-within:bg-surface focus-within:border-primary">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary/50" style={{ fontVariationSettings: "'FILL' 1" }}>mail</span>
                  <input className="w-full bg-transparent border-none py-3 pl-10 pr-4 text-on-surface focus:outline-none focus:ring-0 font-body placeholder:text-surface-dim" id="email" onChange={(event) => setEmail(event.target.value)} placeholder="fleet@maarg.ai" type="email" value={email} />
                </div>
              </div>

              {/* Password Field */}
              <div className="group">
                <div className="flex justify-between items-center mb-2">
                  <label className="block font-label text-xs font-semibold tracking-[0.05em] uppercase text-on-surface-variant" htmlFor="password">Password</label>
                </div>
                <div className="relative bg-surface-container-lowest border-b-2 border-transparent transition-colors duration-200 focus-within:bg-surface focus-within:border-primary">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary/50" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
                  <input className="w-full bg-transparent border-none py-3 pl-10 pr-10 text-on-surface focus:outline-none focus:ring-0 font-body placeholder:text-surface-dim" id="password" onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" type={showPassword ? "text" : "password"} value={password} />
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary/50 hover:text-secondary transition-colors cursor-pointer"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <span className="material-symbols-outlined">
                      {showPassword ? "visibility" : "visibility_off"}
                    </span>
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 space-y-3">
                <button className="w-full py-3 px-4 bg-linear-to-r from-primary to-primary-container text-on-primary font-body font-semibold rounded shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed" disabled={isSubmitting} type="submit">
                  {isSubmitting ? (isLogin ? 'Signing In...' : 'Signing Up...') : (isLogin ? 'Sign In' : 'Sign Up')}
                </button>
                <div className="relative flex items-center justify-center">
                  <span className="absolute w-full h-px bg-surface-container-high"></span>
                  <span className="relative bg-surface px-4 text-xs font-label uppercase tracking-widest text-on-surface-variant">or</span>
                </div>
                <button className="w-full py-3 px-4 text-on-surface font-body font-medium rounded flex items-center justify-center gap-2 border border-outline-variant/30 hover:bg-surface-container-high transition-colors bg-white cursor-pointer" onClick={handleGoogleSignIn} type="button">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
                    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
                    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
                    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
                    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
                  </svg>
                  Continue with Google
                </button>
              </div>
            </form>
          </div>

          {/* Toggle Footer */}
          <div className="bg-surface-container-low p-6 text-center border-t border-outline-variant/15 flex justify-center items-center">
            <p className="font-body text-sm text-secondary m-0">
              {isLogin ? "Don't have an account?" : "Already have an account?"}
              <button
                className="font-semibold text-primary hover:text-primary-container transition-colors ml-2 cursor-pointer focus:outline-none"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? 'Sign Up' : 'Sign In'}
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}