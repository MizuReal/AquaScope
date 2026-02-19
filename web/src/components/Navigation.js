"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AuthModal from "@/components/AuthModal";
import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export default function Navigation() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("login");
  const [sessionUser, setSessionUser] = useState(null);

  const getDisplayName = (user) => {
    const metadata = user?.user_metadata || {};
    return (
      metadata.display_name ||
      metadata.full_name ||
      metadata.name ||
      user?.email?.split("@")[0] ||
      "User"
    );
  };

  const getInitials = (name) => {
    const tokens = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return "U";
    if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase();
    return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
  };

  const openModal = (selectedMode = "login") => {
    setMode(selectedMode);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      return;
    }

    let isMounted = true;

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }
      setSessionUser(data?.session?.user || null);
    };

    syncSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }
      if (session?.user) {
        setSessionUser(session.user);
        return;
      }

      if (event === "SIGNED_OUT") {
        setSessionUser(null);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleDashboardClick = async () => {
    if (!supabase) {
      router.push("/dashboard");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        openModal("login");
        return;
      }

      const userId = session?.user?.id;
      const role = userId ? await getUserRole(userId) : null;
      router.push(isAdminRole(role) ? "/admin/dashboard" : "/dashboard");
    } catch {
      openModal("login");
    }
  };

  const handleProfileClick = async () => {
    if (!supabase) {
      router.push("/dashboard");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        openModal("login");
        return;
      }

      const role = await getUserRole(session.user.id);
      router.push(isAdminRole(role) ? "/admin/dashboard" : "/dashboard");
    } catch {
      router.push("/dashboard");
    }
  };

  const handleLogout = async () => {
    if (!supabase) {
      setSessionUser(null);
      return;
    }

    await supabase.auth.signOut();
    setSessionUser(null);
    router.refresh();
  };

  const displayName = getDisplayName(sessionUser);
  const initials = getInitials(displayName);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-[0.4em] text-slate-900">
            AQUASCOPE
          </span>
          <div className="flex flex-wrap items-center gap-2 text-sm uppercase tracking-[0.3em] text-slate-600">
            <a className="rounded-full px-4 py-2 normal-case transition hover:bg-slate-100" href="#about">
              About
            </a>
            <button
              type="button"
              className="rounded-full px-4 py-2 transition hover:bg-slate-100"
              onClick={handleDashboardClick}
            >
              Dashboard
            </button>
            {sessionUser ? (
              <>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-xs font-semibold tracking-normal text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
                  type="button"
                  onClick={handleProfileClick}
                  aria-label="Open profile"
                  title={displayName}
                >
                  {initials}
                </button>
                <button
                  className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  type="button"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <button
                  className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  type="button"
                  onClick={() => openModal("login")}
                >
                  Login
                </button>
                <button
                  className="rounded-full bg-sky-600 px-4 py-2 text-white transition hover:-translate-y-0.5 hover:bg-sky-700"
                  type="button"
                  onClick={() => openModal("register")}
                >
                  Register
                </button>
              </>
            )}
          </div>
        </nav>
      </header>
      <AuthModal open={modalOpen} mode={mode} onClose={closeModal} onModeChange={setMode} />
    </>
  );
}
