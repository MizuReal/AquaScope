import { createContext, useContext, useEffect, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const AUTH_HASH_KEYS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "type",
  "provider_token",
  "provider_refresh_token",
];

/** Strip Supabase auth tokens from the URL hash so stale tokens are never re-parsed. */
function stripAuthHashParams() {
  if (typeof window === "undefined") return;
  const raw = window.location.hash;
  if (!raw || raw.length <= 1) return;

  const hashParams = new URLSearchParams(raw.slice(1));
  if (!AUTH_HASH_KEYS.some((k) => hashParams.has(k))) return;

  AUTH_HASH_KEYS.forEach((k) => hashParams.delete(k));
  const remaining = hashParams.toString();
  const newUrl = `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`;
  window.history.replaceState(null, "", newUrl);
}

/**
 * Single source of truth for Supabase auth state across the whole app.
 *
 * This context calls `getSession()` and registers `onAuthStateChange`
 * exactly once, eliminating the race conditions and double-loading
 * flashes that occur when every layout/page does it independently.
 */
const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Single getSession call — shared by all consumers via context
    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data?.session ?? null);
      setLoading(false);
    });

    // Single onAuthStateChange listener — propagates to all consumers via context
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      setLoading(false);

      // After Supabase consumes the URL tokens, strip them so a page refresh
      // won't re-parse stale/expired tokens (causing 429s on /token endpoint).
      if (_event === "SIGNED_IN" || _event === "TOKEN_REFRESHED") {
        stripAuthHashParams();
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
