import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import UserSamples from "@/components/UserSamples";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const configMissing = !supabase || !isSupabaseConfigured;

export default function ScansPage() {
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (configMissing) return;
    let isMounted = true;

    const bootstrap = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) { setAuthError("Unable to verify your session. Please try logging in again."); setChecking(false); return; }
      if (!data?.session) { setAuthReady(false); setChecking(false); return; }
      setAuthReady(true);
      setChecking(false);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) { if (event === "SIGNED_OUT") setAuthReady(false); }
      else setAuthReady(true);
    });

    return () => { isMounted = false; listener.subscription.unsubscribe(); };
  }, []);

  if (configMissing) {
    return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="max-w-md space-y-4"><p className="text-xl font-semibold">Configure Supabase auth</p><p className="text-sm text-slate-500">Add VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to .env so we can secure the scans route.</p><Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">Return home</Link></div></div>);
  }
  if (authError) {
    return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="max-w-md space-y-4"><p className="text-xl font-semibold">Authentication unavailable</p><p className="text-sm text-slate-500">{authError}</p><Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">Return home</Link></div></div>);
  }
  if (checking) {
    return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="space-y-4"><p className="text-xl font-semibold">Verifying your session...</p><p className="text-sm text-slate-500">Hang tight while we secure your workspace.</p></div></div>);
  }
  if (!authReady) {
    return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="space-y-4"><p className="text-xl font-semibold">Please sign in</p><p className="text-sm text-slate-500">Log in to view your scan history.</p><Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">Return home</Link></div></div>);
  }

  return (
    <section className="px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">My scans</p>
          <h1 className="text-3xl font-semibold">Prediction history</h1>
          <p className="text-sm text-slate-500">All samples linked to your account.</p>
        </header>
        <UserSamples />
      </div>
    </section>
  );
}
