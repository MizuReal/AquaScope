"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const navItems = [
  { label: "Admin dashboard", href: "/admin/dashboard" },
  { label: "User control", href: "/admin/users" },
  { label: "Logout", href: "/logout" },
];

const configMissing = !supabase || !isSupabaseConfigured;

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  const activeItem = useMemo(() => {
    const match = navItems.find((item) => item.href === pathname);
    return match?.label || navItems[0].label;
  }, [pathname]);

  useEffect(() => {
    if (configMissing) {
      setChecking(false);
      return;
    }

    let isMounted = true;

    const bootstrap = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) {
        setAuthError("Unable to verify your session.");
        setChecking(false);
        return;
      }

      if (!data?.session?.user?.id) {
        router.replace("/");
        return;
      }

      try {
        const role = await getUserRole(data.session.user.id);
        if (!isMounted) return;

        if (!isAdminRole(role)) {
          router.replace("/dashboard");
          return;
        }

        setChecking(false);
      } catch {
        if (!isMounted) return;
        setAuthError("Unable to load your profile role.");
        setChecking(false);
      }
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;

        if (!session) {
          if (event === "SIGNED_OUT") {
            router.replace("/");
          }
          return;
        }

        /* Re-verify admin role on token refresh / sign-in */
        try {
          const role = await getUserRole(session.user.id);
          if (!isMounted) return;
          if (!isAdminRole(role)) {
            router.replace("/dashboard");
          }
        } catch {
          /* non-critical — initial check already passed */
        }
      },
    );

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  const sidebarWidth = collapsed ? "w-20" : "w-64";

  const handleNavItemClick = async (item) => {
    if (item.label === "Logout") {
      if (supabase) {
        await supabase.auth.signOut();
      }
      router.replace("/");
      return;
    }

    if (item.href) {
      router.push(item.href);
    }
  };

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to web/.env.local.
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
          <p className="text-xl font-semibold">Admin access unavailable</p>
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
          <p className="text-xl font-semibold">Verifying admin access...</p>
          <p className="text-sm text-slate-500">Hang tight while we secure the admin workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex">
        <aside
          className={`${sidebarWidth} sticky top-0 flex h-screen flex-col border-r border-slate-200 bg-white px-4 py-6 transition-all duration-300 ease-out`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-[0.4em] text-sky-600">AQ</span>
              {!collapsed && <p className="text-sm text-slate-500">Admin</p>}
            </div>
            <button
              type="button"
              aria-label="Toggle sidebar"
              className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-500 hover:bg-slate-100"
              onClick={() => setCollapsed((prev) => !prev)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <nav className="mt-10 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.label}
                className={`flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left text-sm uppercase tracking-[0.35em] transition ${
                  activeItem === item.label
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : "text-slate-500 hover:border-slate-200 hover:bg-slate-50"
                }`}
                onClick={() => handleNavItemClick(item)}
              >
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            <p>Mode: Administrator</p>
            <p>Access level: role = 1</p>
            <p>Scope: global admin panel</p>
          </div>

          {!collapsed && (
            <Link href="/" className="mt-3 text-xs uppercase tracking-[0.4em] text-sky-600">
              Back to site
            </Link>
          )}
        </aside>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
