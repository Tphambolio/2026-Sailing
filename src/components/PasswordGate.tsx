import { useState, type FormEvent, type ReactNode } from 'react';

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
    <div className="h-screen flex items-center justify-center bg-slate-900 px-4">
      <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-sm">
        <h1 className="text-white text-lg font-bold mb-1 flex items-center gap-2">
          <span className="text-xl">🌊</span> Mediterranean Odyssey
        </h1>
        <p className="text-slate-400 text-sm mb-4">This trip journal is password-protected.</p>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          placeholder="Password"
          autoFocus
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 mb-2"
        />
        {error && <p className="text-red-400 text-xs mb-2">Incorrect password.</p>}
        <button
          type="submit"
          disabled={!input || checking}
          className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
