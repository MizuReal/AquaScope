"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const configMissing = !supabase || !isSupabaseConfigured;

const placeholderCards = [
  {
    title: "Profile preferences",
    description: "Update your display name, avatar, and personal details from one place.",
    status: "Planned",
  },
  {
    title: "Notifications",
    description: "Control alerts for scan completions, risk flags, and account updates.",
    status: "Planned",
  },
  {
    title: "Security",
    description: "Manage sign-in sessions and account protection settings.",
    status: "Planned",
  },
  {
    title: "Integrations",
    description: "Connect external tools and export your water quality insights.",
    status: "Planned",
  },
];

export default function SettingsPage() {
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (configMissing) {
      return;
    }

    let isMounted = true;

    const bootstrap = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) {
        setAuthError("Unable to verify your session. Please try logging in again.");
        setChecking(false);
        return;
      }

      if (!data?.session) {
        setAuthReady(false);
        setChecking(false);
        return;
      }

      setAuthReady(true);
      setChecking(false);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setAuthReady(false);
      } else {
        setAuthReady(true);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to web/.env.local so we can secure the settings route.
          </p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Authentication unavailable</p>
          <p className="text-sm text-slate-500">{authError}</p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="space-y-4">
          <p className="text-xl font-semibold">Verifying your session...</p>
          <p className="text-sm text-slate-500">Hang tight while we secure your workspace.</p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="space-y-4">
          <p className="text-xl font-semibold">Please sign in</p>
          <p className="text-sm text-slate-500">Log in to access your settings.</p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Settings</p>
          <h1 className="text-3xl font-semibold">Account settings</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            This page is a placeholder for upcoming account controls. You can use it now as a preview of where profile,
            notification, and security settings will appear.
          </p>
        </header>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Settings workspace</p>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Coming soon</p>
            </div>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-sky-700">
              Placeholder
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {placeholderCards.map((item) => (
            <article key={item.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                  {item.status}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-500">{item.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
