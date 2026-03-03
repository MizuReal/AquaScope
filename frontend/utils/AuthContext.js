import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabaseClient';

const PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';

const isDeactivated = (status) => String(status || '').toLowerCase() === 'deactivated';

/**
 * Check a user's profile status in the `profiles` table.
 * Returns `true` if the account is active (or if the check fails — fail-open).
 */
export async function checkProfileActive(userId) {
  if (!userId) return false;
  try {
    const { data: profile } = await supabase
      .from(PROFILES_TABLE)
      .select('status')
      .eq('id', userId)
      .maybeSingle();
    return !isDeactivated(profile?.status);
  } catch {
    return true; // fail-open on network errors
  }
}

const AuthContext = createContext({
  session: null,
  user: null,
  isAuthenticated: false,
  loading: true,
  deactivationNotice: '',
  clearDeactivationNotice: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const DEACTIVATION_MESSAGE =
  'Your account has been deactivated. Please contact your lab administrator for assistance.';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deactivationNotice, setDeactivationNotice] = useState('');
  const deactivationShownRef = useRef(false);
  const isMountedRef = useRef(true);
  const realtimeChannelRef = useRef(null);

  const clearDeactivationNotice = useCallback(() => setDeactivationNotice(''), []);
  const reportDeactivation = useCallback(() => setDeactivationNotice(DEACTIVATION_MESSAGE), []);

  const handleDeactivated = async () => {
    if (deactivationShownRef.current) return;
    deactivationShownRef.current = true;
    try { await supabase.auth.signOut(); } catch {}
    if (isMountedRef.current) {
      setSession(null);
      setDeactivationNotice(DEACTIVATION_MESSAGE);
    }
  };

  // Subscribe to realtime profile changes for the current user
  const subscribeToProfile = (userId) => {
    unsubscribeFromProfile(); // clean up any previous subscription
    if (!userId) return;

    const channel = supabase
      .channel(`auth-profile-guard-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: PROFILES_TABLE,
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          if (isDeactivated(payload.new?.status)) {
            handleDeactivated();
          }
        },
      )
      .subscribe();

    realtimeChannelRef.current = channel;
  };

  const unsubscribeFromProfile = () => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    const initAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.warn('[Auth] getSession error:', error.message);
        if (!isMountedRef.current) return;

        const s = data?.session ?? null;
        if (s?.user?.id) {
          const active = await checkProfileActive(s.user.id);
          if (!active) {
            await handleDeactivated();
            setLoading(false);
            return;
          }
          subscribeToProfile(s.user.id);
        }
        setSession(s);
      } catch (e) {
        console.warn('[Auth] Unexpected getSession error:', e);
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };

    initAuth();

    // Auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMountedRef.current) return;

      if (!newSession) {
        // Signed out — reset
        deactivationShownRef.current = false;
        unsubscribeFromProfile();
        setSession(null);
        return;
      }

      // New session — re-subscribe to profile changes
      const userId = newSession.user?.id;
      if (userId) subscribeToProfile(userId);
      setSession(newSession);
    });

    // Foreground check — catches deactivation when realtime misses (e.g. lost connection)
    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active' || !isMountedRef.current) return;
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data?.session?.user?.id;
        if (userId) {
          const active = await checkProfileActive(userId);
          if (!active) await handleDeactivated();
        }
      } catch {}
    });

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
      appStateSub.remove();
      unsubscribeFromProfile();
    };
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    isAuthenticated: !!session,
    loading,
    deactivationNotice,
    clearDeactivationNotice,
    reportDeactivation,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
