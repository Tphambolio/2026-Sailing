import { useState, type FormEvent, type ReactNode } from 'react';
import { Sailboat } from 'lucide-react';
import { getStopPhotoUrl } from '../lib/supabase';
import StopImage from './StopImage';

// Backdrop for the gate — a sunset over the Aegean from Serifos. Photos are
// publicly readable anyway, so showing one before the password leaks nothing.
const GATE_PHOTO = 'serifos-day-2/1791222577949.jpg';

const STORAGE_KEY = 'site-unlocked-hash';

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface PasswordGateProps {
  children: ReactNode;
}

// Gates viewing behind a shared password — deters casual visitors, not a
// determined attacker. VITE_SITE_PASSWORD_HASH holds a SHA-256 hex digest of
// the real password (never the plaintext); unset means the gate is off, which
// keeps local dev unlocked by default. Storing the hash itself (not just a
// boolean) in localStorage means changing the password invalidates old unlocks
// automatically, with no separate versioning needed.
export default function PasswordGate({ children }: PasswordGateProps) {
  const requiredHash = import.meta.env.VITE_SITE_PASSWORD_HASH as string | undefined;
  const [unlocked, setUnlocked] = useState(
    () => !requiredHash || localStorage.getItem(STORAGE_KEY) === requiredHash
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  if (unlocked) return <>{children}</>;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    const hash = await sha256Hex(input);
    setChecking(false);
    if (hash === requiredHash) {
      localStorage.setItem(STORAGE_KEY, hash);
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-start bg-slate-950 px-5 pt-[18vh] overflow-hidden">
      <StopImage
        src={getStopPhotoUrl(GATE_PHOTO)}
        alt=""
        width={1200}
        height={1600}
        sizes="100vw"
        loading="eager"
        className="absolute inset-0 w-full h-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/40 to-slate-950/90" aria-hidden />

      <div className="relative w-full max-w-sm text-center">
        <Sailboat size={34} className="mx-auto mb-3 text-coral-300" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-coral-300 mb-2">Sveti Ivan · 2026–27</p>
        <h1 className="font-serif text-4xl font-bold text-white leading-tight drop-shadow">Mediterranean Odyssey</h1>
        <p className="mt-2 mb-8 text-slate-200">A family sailing journal</p>

        <form onSubmit={handleSubmit} className="text-left">
          <label htmlFor="site-password" className="sr-only">Password</label>
          <input
            id="site-password"
            type="password"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
            className="w-full bg-slate-900/70 backdrop-blur border border-slate-500/60 rounded-xl px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400 mb-3"
          />
          {error && <p className="text-coral-300 text-sm mb-3" role="alert">Incorrect password.</p>}
          <button
            type="submit"
            disabled={!input || checking}
            className="w-full px-4 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700/80 disabled:text-slate-400 disabled:cursor-not-allowed rounded-xl text-white text-base font-semibold"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
