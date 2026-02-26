"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AuthModal from "@/components/AuthModal";
import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";

const resolveAvatarUrl = async (rawUrlOrPath) => {
  if (!rawUrlOrPath) return "";
  if (/^https?:\/\//i.test(rawUrlOrPath)) return rawUrlOrPath;

  const marker = `/${SUPABASE_AVATAR_BUCKET}/`;
  let path = rawUrlOrPath;
  const idx = rawUrlOrPath.indexOf(marker);
  if (idx !== -1) {
    path = rawUrlOrPath.slice(idx + marker.length);
  }

  try {
    const { data } = supabase.storage.from(SUPABASE_AVATAR_BUCKET).getPublicUrl(path);
    return data?.publicUrl || "";
  } catch {
    return "";
  }
};

export default function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("login");
  const [sessionUser, setSessionUser] = useState(null);
  const [displayName, setDisplayName] = useState("User");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [authNotice, setAuthNotice] = useState("");

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
    if (location.pathname !== "/") return;

    const params = new URLSearchParams(location.search);
    const auth = params.get("auth");
    if (auth !== "required") return;

    setMode("login");
    setAuthNotice("Sign in required");
    setModalOpen(true);

    params.delete("auth");
    params.delete("reason");
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash || ""}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  const hydrateIdentity = useCallback(async (user, activeRef) => {
    if (!user) {
      if (activeRef()) {
        setDisplayName("User");
        setAvatarUrl("");
        setAvatarFailed(false);
      }
      return;
    }

    const metadataName = getDisplayName(user);
    const metadataAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "";

    if (activeRef()) {
      setDisplayName(metadataName);
      setAvatarFailed(false);
    }

    const resolvedMetaAvatar = await resolveAvatarUrl(metadataAvatar);
    if (activeRef()) {
      setAvatarUrl(resolvedMetaAvatar || metadataAvatar || "");
    }

    try {
      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!activeRef() || profileResult.error || !profileResult.data) {
        return;
      }

      if (profileResult.data.display_name) {
        setDisplayName(profileResult.data.display_name);
      }

      if (profileResult.data.avatar_url) {
        const resolvedProfileAvatar = await resolveAvatarUrl(profileResult.data.avatar_url);
        if (activeRef()) {
          setAvatarUrl(resolvedProfileAvatar || profileResult.data.avatar_url);
        }
      }
    } catch {
    }
  }, []);

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
      const user = data?.session?.user || null;
      setSessionUser(user);
      await hydrateIdentity(user, () => isMounted);
    };

    syncSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }
      if (session?.user) {
        setSessionUser(session.user);
        setAuthNotice("");
        hydrateIdentity(session.user, () => isMounted);
        return;
      }

      if (event === "SIGNED_OUT") {
        setSessionUser(null);
        setDisplayName("User");
        setAvatarUrl("");
        setAvatarFailed(false);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleDashboardClick = async () => {
    if (!supabase) {
      navigate("/dashboard");
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
      navigate(isAdminRole(role) ? "/admin/dashboard" : "/dashboard");
    } catch {
      openModal("login");
    }
  };

  const handleProfileClick = async () => {
    if (!supabase) {
      navigate("/dashboard");
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
      navigate(isAdminRole(role) ? "/admin/dashboard" : "/dashboard");
    } catch {
      navigate("/dashboard");
    }
  };

  const handleLogout = async () => {
    if (!supabase) {
      setSessionUser(null);
      return;
    }

    await supabase.auth.signOut();
    setSessionUser(null);
    navigate(0);
  };

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
                  {avatarUrl && !avatarFailed ? (
                    <img
                      src={avatarUrl}
                      alt={`${displayName} profile picture`}
                      className="h-full w-full rounded-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                    />
                  ) : (
                    initials
                  )}
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
      <AuthModal open={modalOpen} mode={mode} onClose={closeModal} onModeChange={setMode} noticeMessage={authNotice} />
    </>
  );
}
