import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { isAdminRole } from "@/lib/profileRole";
import { supabase } from "@/lib/supabaseClient";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";

const isDeactivatedAccount = (status) => String(status || "").toLowerCase() === "deactivated";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "My scans", href: "/dashboard/scans", icon: "scans" },
  { label: "Community", href: "/dashboard/community", icon: "community" },
  { label: "Analytics", href: "/dashboard/analytics", icon: "analytics" },
  { label: "Profile", href: "/dashboard/profile", icon: "profile" },
  { label: "Logout", href: "/logout", icon: "logout" },
];

function NavIcon({ icon }) {
  const commonProps = {
    xmlns: "http://www.w3.org/2000/svg",
    className: "h-4 w-4",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  if (icon === "dashboard") {
    return (
      <svg {...commonProps}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="4" rx="1.5" />
        <rect x="14" y="10" width="7" height="11" rx="1.5" />
        <rect x="3" y="13" width="7" height="8" rx="1.5" />
      </svg>
    );
  }

  if (icon === "scans") {
    return (
      <svg {...commonProps}>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <line x1="9" y1="12" x2="15" y2="12" />
      </svg>
    );
  }

  if (icon === "analytics") {
    return (
      <svg {...commonProps}>
        <line x1="4" y1="20" x2="20" y2="20" />
        <rect x="6" y="11" width="3" height="7" rx="0.8" />
        <rect x="11" y="8" width="3" height="10" rx="0.8" />
        <rect x="16" y="5" width="3" height="13" rx="0.8" />
      </svg>
    );
  }

  if (icon === "community") {
    return (
      <svg {...commonProps}>
        <circle cx="8" cy="9" r="2" />
        <circle cx="16" cy="9" r="2" />
        <path d="M4.5 18a3.5 3.5 0 0 1 7 0" />
        <path d="M12.5 18a3.5 3.5 0 0 1 7 0" />
      </svg>
    );
  }

  if (icon === "settings") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
      </svg>
    );
  }

  if (icon === "profile") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    );
  }

  if (icon === "logout") {
    return (
      <svg {...commonProps}>
        <path d="M15 17l5-5-5-5" />
        <path d="M20 12H9" />
        <path d="M12 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M9 5h10" />
      <path d="M9 12h10" />
      <path d="M9 19h10" />
      <path d="M5 5h.01" />
      <path d="M5 12h.01" />
      <path d="M5 19h.01" />
    </svg>
  );
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authToast, setAuthToast] = useState("");

  const activeItem = useMemo(() => {
    const match = navItems.find((item) => item.href === pathname);
    return match?.label || navItems[0].label;
  }, [pathname]);

  const sidebarWidth = collapsed ? "w-20" : "w-64";

  useEffect(() => {
    let isMounted = true;

    const guardByProfile = async (userId) => {
      const { data: profile, error: profileError } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("role, status")
        .eq("id", userId)
        .maybeSingle();

      if (!isMounted) return false;

      if (profileError) {
        navigate("/?auth=required&reason=signin_required", { replace: true });
        return false;
      }

      if (isDeactivatedAccount(profile?.status)) {
        setAuthToast("Account is deactivated.");
        setAuthChecked(false);
        setTimeout(async () => {
          if (!isMounted) return;
          try {
            await supabase.auth.signOut();
          } catch {
          }
          if (!isMounted) return;
          navigate("/?auth=required&reason=account_deactivated", { replace: true });
        }, 1200);
        return false;
      }

      if (isAdminRole(profile?.role)) {
        navigate("/admin/dashboard", { replace: true });
        return false;
      }

      setAuthChecked(true);
      return true;
    };

    const guardAccess = async () => {
      if (!supabase) {
        navigate("/?auth=required&reason=signin_required", { replace: true });
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error || !data?.session?.user?.id) {
        navigate("/?auth=required&reason=signin_required", { replace: true });
        return;
      }

      await guardByProfile(data.session.user.id);
    };

    guardAccess();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (!session?.user?.id) {
        if (event === "SIGNED_OUT") {
          navigate("/?auth=required&reason=signin_required", { replace: true });
        }
        return;
      }

      await guardByProfile(session.user.id);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [navigate]);

  const handleNavItemClick = async (item) => {
    if (item.label === "Logout") {
      if (supabase) {
        await supabase.auth.signOut();
      }
      navigate("/", { replace: true });
      return;
    }
    if (item.href) {
      navigate(item.href);
    }
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        {authToast ? (
          <div className="pointer-events-none fixed right-4 top-4 z-50 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 shadow-lg">
            {authToast}
          </div>
        ) : null}
        <div className="space-y-3">
          <p className="text-xl font-semibold">Verifying your session...</p>
          <p className="text-sm text-slate-500">Hang tight while we secure your workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex">
        <aside
          className={`${sidebarWidth} sticky top-0 flex h-screen flex-col border-r border-slate-700 bg-slate-900 px-4 py-6 transition-all duration-300 ease-out`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-[0.4em] text-sky-400">AQ</span>
              {!collapsed && <p className="text-sm text-slate-400">Console</p>}
            </div>
            <button
              type="button"
              aria-label="Toggle sidebar"
              className="rounded-full border border-slate-700 bg-slate-800 p-2 text-slate-400 hover:bg-slate-700"
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
                    ? "border-sky-500/30 bg-sky-500/15 text-sky-400"
                    : "text-slate-400 hover:border-slate-600 hover:bg-slate-800"
                }`}
                onClick={() => handleNavItemClick(item)}
              >
                <span className="flex h-5 w-5 items-center justify-center text-current">
                  <NavIcon icon={item.icon} />
                </span>
                {!collapsed && <span>{item.label}</span>}
              </button>
            ))}
          </nav>
          <div
            className={`mt-auto rounded-2xl border border-slate-700 bg-slate-800/50 text-xs text-slate-400 ${
              collapsed ? "p-3" : "space-y-3 p-4"
            }`}
          >
            {collapsed ? (
              <div className="flex flex-col items-center gap-2" aria-label="System status indicators">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
              </div>
            ) : (
              <>
                <p className="text-[10px] uppercase tracking-[0.32em] text-slate-500">System status</p>
                <p>OCR extraction: Active</p>
                <p>Risk assessment model: Ready</p>
                <p>Water quality analysis: Live</p>
              </>
            )}
          </div>
          {!collapsed && (
            <Link to="/" className="mt-3 text-xs uppercase tracking-[0.4em] text-sky-400">
              Back to site
            </Link>
          )}
        </aside>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
