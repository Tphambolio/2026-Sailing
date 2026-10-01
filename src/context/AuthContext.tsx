import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session, Provider } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type OAuthProvider = 'google' | 'facebook';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithProvider: (provider: OAuthProvider) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let initialResolved = false;
    const resolveInitial = (session: Session | null) => {
      if (initialResolved) return;
      initialResolved = true;
      clearTimeout(timeoutId);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    };

    // getSession() can hang indefinitely with no rejection if Supabase Auth
    // is unreachable (its token-refresh call never resolves) — fall back to
    // a signed-out view instead of blocking the whole app on this screen.
    const timeoutId = setTimeout(() => resolveInitial(null), 5000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => resolveInitial(session))
      .catch(() => resolveInitial(null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        resolveInitial(session); // in case this fires before getSession() settles
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const signInWithProvider = async (provider: OAuthProvider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: {
        redirectTo: window.location.href,
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithProvider, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
