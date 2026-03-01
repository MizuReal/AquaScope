import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const navItems = [
  { label: "Admin dashboard", href: "/admin/dashboard", icon: "dashboard" },
  { label: "User control", href: "/admin/users", icon: "users" },
  { label: "System Analytics", href: "/admin/analytics", icon: "analytics" },
  { label: "System Settings", href: "/admin/system-settings", icon: "system" },
  { label: "Settings", href: "/admin/settings", icon: "settings" },
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

  if (icon === "users") {
    return (
      <svg {...commonProps}>
        <circle cx="8" cy="9" r="2" />
        <circle cx="16" cy="9" r="2" />
        <path d="M4.5 18a3.5 3.5 0 0 1 7 0" />
        <path d="M12.5 18a3.5 3.5 0 0 1 7 0" />
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

  if (icon === "system") {
    return (
      <svg {...commonProps}>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
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

  if (icon === "logout") {
    return (
      <svg {...commonProps}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
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

const configMissing = !supabase || !isSupabaseConfigured;

export default function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [collapsed, setCollapsed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  const activeItem = useMemo(() => {
    const match = navItems.find((item) => item.href === pathname);
    return match?.label || navItems[0].label;
  }, [pathname]);

  useEffect(() => {
    // Wait for the shared AuthContext to resolve before running the role check
    if (authLoading) return;

    if (!userId) {
      navigate("/", { replace: true });
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const role = await getUserRole(userId);
        if (!isMounted) return;

        if (!isAdminRole(role)) {
          navigate("/dashboard", { replace: true });
          return;
        }

        setChecking(false);
      } catch {
        if (!isMounted) return;
        setAuthError("Unable to load your profile role.");
        setChecking(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [userId, authLoading, navigate]);

  const sidebarWidth = collapsed ? "w-20" : "w-64";

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

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to .env.local.
          </p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">
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
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">
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
          className={`${sidebarWidth} sticky top-0 flex h-screen flex-col border-r border-slate-700 bg-slate-900 px-4 py-6 transition-all duration-300 ease-out`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-[0.4em] text-sky-400">AQ</span>
              {!collapsed && <p className="text-sm text-slate-400">Admin</p>}
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

          {!collapsed && (
            <div className="mt-auto space-y-3 rounded-2xl border border-slate-700 bg-slate-800/50 p-4 text-xs text-slate-400">
              <p>Mode: Administrator</p>
              <p>Access level: role = 1</p>
              <p>Scope: global admin panel</p>
            </div>
          )}

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
