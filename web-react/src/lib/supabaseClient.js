import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY;
const isEdgeBrowser = typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent || "");
const edgeNoOpLock = async (_name, _acquireTimeout, fn) => await fn();

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  console.warn(
    "[Supabase] Missing browser-safe Supabase env vars. Set VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: "aquascope-auth",
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        ...(isEdgeBrowser ? { lock: edgeNoOpLock, lockAcquireTimeout: 2000 } : {}),
      },
    })
  : null;
