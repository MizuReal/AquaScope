"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import AuthModal from "@/components/AuthModal";
import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";

const extractAuthCallbackParams = (location) => {
  const searchParams = new URLSearchParams(location.search || "");
  const hashValue = (location.hash || "").startsWith("#") ? location.hash.slice(1) : (location.hash || "");
  const hashParams = new URLSearchParams(hashValue);

  const params = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    params.set(key, value);
  }
  for (const [key, value] of hashParams.entries()) {
    if (!params.has(key)) {
      params.set(key, value);
    }
  }

  return params;
};

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
  const { user: sessionUser } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("login");
  const [displayName, setDisplayName] = useState("User");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [toastMessage, setToastMessage] = useState("");

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

  useEffect(() => {
    if (location.pathname !== "/") return;

    const params = extractAuthCallbackParams(location);
    const errorCode = params.get("error_code") || "";
    const error = params.get("error") || "";
    const errorDescription = params.get("error_description") || "";

    const isExpiredLink =
      errorCode.toLowerCase() === "otp_expired" ||
      errorDescription.toLowerCase().includes("expired");
    const isInvalidLink =
      errorCode.toLowerCase() === "otp_disabled" ||
      error.toLowerCase() === "access_denied" ||
      errorDescription.toLowerCase().includes("invalid");

    if (!isExpiredLink && !isInvalidLink) return;

    setMode("login");
    setAuthNotice(
      isExpiredLink
        ? "This confirmation link has expired. Please sign in and request a new confirmation email."
        : "This confirmation link is invalid. Please sign in and request a new confirmation email.",
    );
    setModalOpen(true);

    const cleanSearch = new URLSearchParams(location.search || "");
    ["error", "error_code", "error_description", "code"].forEach((key) => cleanSearch.delete(key));
    const nextSearch = cleanSearch.toString();

    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
  }, [location, navigate]);

  useEffect(() => {
    if (location.pathname !== "/") return;

    const params = new URLSearchParams(location.search);
    const signup = params.get("signup");
    if (signup !== "success" || !sessionUser) return;

    setToastMessage("Thank you for signing up!");

    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 3200);

    params.delete("signup");
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash || ""}`, { replace: true });

    return () => window.clearTimeout(timer);
  }, [location.hash, location.pathname, location.search, navigate, sessionUser]);

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
    if (!supabase || !isSupabaseConfigured) return;
    // Sync display name & avatar whenever the authenticated user changes
    if (sessionUser) setAuthNotice("");
    let isMounted = true;
    hydrateIdentity(sessionUser, () => isMounted);
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.id, hydrateIdentity]);

  const handleDashboardClick = async () => {
    if (!sessionUser) {
      openModal("login");
      return;
    }
    try {
      const role = await getUserRole(sessionUser.id);
      navigate(isAdminRole(role) ? "/admin/dashboard" : "/dashboard");
    } catch {
      openModal("login");
    }
  };

  const handleProfileClick = async () => {
    if (!sessionUser) {
      openModal("login");
      return;
    }
    try {
      const role = await getUserRole(sessionUser.id);
      navigate(isAdminRole(role) ? "/admin/dashboard" : "/dashboard");
    } catch {
      navigate("/dashboard");
    }
  };

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
      // AuthContext's onAuthStateChange sets user=null, propagating to all consumers
    }
    navigate("/");
  };

  const initials = getInitials(displayName);

  return (
    <>
      {toastMessage ? (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
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
