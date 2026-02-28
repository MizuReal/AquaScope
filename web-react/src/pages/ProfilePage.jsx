import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";
const configMissing = !supabase || !isSupabaseConfigured;

const getExtensionFromMimeType = (mimeType) => {
  if (!mimeType || typeof mimeType !== "string") return "jpg";
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("heic")) return "heic";
  if (normalized.includes("heif")) return "heif";
  return "jpg";
};

const getAvatarPathFromUrl = (url) => {
  if (!url) return "";
  const marker = `/${SUPABASE_AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return "";
  return url.slice(index + marker.length);
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

const statusToneClassName = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("unable") || normalized.includes("required") || normalized.includes("sign in")) {
    return "text-rose-600";
  }
  return "text-emerald-600";
};

export default function ProfilePage() {
  const fileInputRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    organization: "",
    avatarUrl: "",
  });

  useEffect(() => {
    if (configMissing) return;
    let isMounted = true;
    // Prevents the immediate SIGNED_IN auth event from running loadProfile
    // in parallel with the bootstrap call, causing a redundant double-load.
    let sessionAcquired = false;

    const loadProfile = async (session) => {
      if (!isMounted) return;
      setStatus("");
      setLoading(true);

      try {
        const user = session?.user;
        if (!user) {
          if (isMounted) {
            setProfile({ name: "", email: "", organization: "", avatarUrl: "" });
          }
          return;
        }

        const { data, error } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("display_name, organization, avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!isMounted) return;

        if (error) {
          console.warn("[Supabase] profile fetch failed:", error.message || error);
        }

        const resolvedAvatar = await resolveAvatarUrl(data?.avatar_url || "");

        if (!isMounted) return;

        setProfile({
          name: data?.display_name || user.user_metadata?.display_name || user.user_metadata?.name || "",
          email: user.email || "",
          organization: data?.organization || user.user_metadata?.organization || "",
          avatarUrl: resolvedAvatar || data?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || "",
        });
      } catch (error) {
        console.warn("[Supabase] profile load error:", error?.message || error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

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
      await loadProfile(data.session);
      // Mark session as acquired so future auth events can trigger reloads.
      sessionAcquired = true;
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (!session) {
        if (event === "SIGNED_OUT") {
          setAuthReady(false);
          setProfile({ name: "", email: "", organization: "", avatarUrl: "" });
        }
        return;
      }

      setAuthReady(true);
      // Guard: supabase-js v2 fires SIGNED_IN immediately when a session already exists.
      // Only reload the profile after the bootstrap has finished its own load.
      // Once bootstrap sets sessionAcquired=true it stays true, so any future
      // SIGNED_IN (e.g. after signing out and back in) will correctly reload.
      if (!sessionAcquired) return;
      await loadProfile(session);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleChange = (key, value) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setStatus("");
    setLoading(true);

    try {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user || null;

      if (!user) {
        setStatus("Please sign in to update your profile.");
        return;
      }

      const updates = {
        id: user.id,
        display_name: profile.name || null,
        organization: profile.organization || null,
        avatar_url: profile.avatarUrl || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .upsert(updates, { onConflict: "id" });

      if (error) {
        console.warn("[Supabase] profile update failed:", error.message || error);
        setStatus("Unable to save profile right now.");
        return;
      }

      setStatus("Profile saved.");
    } catch (error) {
      console.warn("[Supabase] profile update error:", error?.message || error);
      setStatus("Unable to save profile right now.");
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async (event) => {
    setStatus("");

    const file = event?.target?.files?.[0];
    if (!file) return;

    try {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user || null;

      if (!user) {
        setStatus("Please sign in to update your profile.");
        return;
      }

      setLoading(true);
      const previousPath = getAvatarPathFromUrl(profile.avatarUrl);
      const extension = getExtensionFromMimeType(file.type);
      const filePath = `${user.id}/${Date.now()}.${extension}`;
      const fileBody = await file.arrayBuffer();
      const contentType = file.type || "image/jpeg";

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_AVATAR_BUCKET)
        .upload(filePath, fileBody, { contentType });

      if (uploadError) {
        console.warn("[Supabase] avatar upload failed:", {
          message: uploadError.message || uploadError,
          statusCode: uploadError.statusCode,
          error: uploadError,
          bucket: SUPABASE_AVATAR_BUCKET,
          filePath,
          contentType,
          userId: user.id,
        });
        setStatus("Unable to upload avatar.");
        return;
      }

      const { data: publicData } = supabase.storage
        .from(SUPABASE_AVATAR_BUCKET)
        .getPublicUrl(filePath);
      const avatarUrl = publicData?.publicUrl || "";

      if (previousPath && previousPath !== filePath) {
        const { error: removeError } = await supabase.storage
          .from(SUPABASE_AVATAR_BUCKET)
          .remove([previousPath]);

        if (removeError) {
          console.warn("[Supabase] previous avatar remove failed:", {
            message: removeError.message || removeError,
            statusCode: removeError.statusCode,
            path: previousPath,
          });
        }
      }

      setProfile((prev) => ({ ...prev, avatarUrl }));
      setStatus("Photo updated. Save changes to confirm.");
    } catch (error) {
      console.warn("[Supabase] avatar upload error:", error?.message || error);
      setStatus("Unable to upload avatar.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setLoading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setStatus("");
    setLoading(true);

    try {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user || null;

      if (!user) {
        setStatus("Please sign in to update your profile.");
        return;
      }

      const storedPath = getAvatarPathFromUrl(profile.avatarUrl);
      if (storedPath) {
        const { error: removeError } = await supabase.storage
          .from(SUPABASE_AVATAR_BUCKET)
          .remove([storedPath]);
        if (removeError) {
          console.warn("[Supabase] avatar remove failed:", removeError.message || removeError);
        }
      }

      const updates = {
        id: user.id,
        avatar_url: null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .upsert(updates, { onConflict: "id" });

      if (error) {
        console.warn("[Supabase] profile update failed:", error.message || error);
        setStatus("Unable to remove avatar right now.");
        return;
      }

      setProfile((prev) => ({ ...prev, avatarUrl: "" }));
      setStatus("Photo removed.");
    } catch (error) {
      console.warn("[Supabase] avatar remove error:", error?.message || error);
      setStatus("Unable to remove avatar right now.");
    } finally {
      setLoading(false);
    }
  };

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to .env so we can secure the profile route.
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
          <p className="text-xl font-semibold">Authentication unavailable</p>
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
          <p className="text-sm text-slate-500">Log in to manage your profile.</p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Profile</p>
          <h1 className="text-3xl font-semibold">My profile</h1>
          <p className="text-sm text-slate-500">Update your account details used across reports and shared views.</p>
        </header>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-[auto,1fr]">
            <div className="flex flex-col items-center gap-3">
              <div className="h-28 w-28 overflow-hidden rounded-full border-2 border-sky-200 bg-sky-50">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt="Profile avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-4xl text-sky-300">
                    <span aria-hidden="true">👤</span>
                  </div>
                )}
              </div>

              <div className="flex w-full flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  onChange={handlePickAvatar}
                  className="hidden"
                />
                <button
                  type="button"
                  className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                >
                  Upload photo
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleRemoveAvatar}
                  disabled={loading || !profile.avatarUrl}
                >
                  Remove photo
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="displayName" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                  Display name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={profile.name}
                  onChange={(event) => handleChange("name", event.target.value)}
                  placeholder="e.g. Lake operations team"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="organization" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                  Organization / lab
                </label>
                <input
                  id="organization"
                  type="text"
                  value={profile.organization}
                  onChange={(event) => handleChange("organization", event.target.value)}
                  placeholder="e.g. City water laboratory"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading}
                  className="rounded-2xl border border-sky-600 bg-sky-600 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Saving..." : "Save changes"}
                </button>
                <p className={`text-sm ${status ? statusToneClassName(status) : "text-slate-500"}`}>
                  {status || "Changes sync to Supabase when saved."}
                </p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}