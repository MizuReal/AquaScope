import { useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

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

const statusTone = (value) => {
  const n = String(value || "").toLowerCase();
  if (
    n.includes("unable") ||
    n.includes("required") ||
    n.includes("sign in") ||
    n.includes("invalid") ||
    n.includes("match") ||
    n.includes("different")
  ) {
    return "text-rose-600";
  }
  return "text-emerald-600";
};

export default function AdminProfilePage() {
  const fileInputRef = useRef(null);
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    organization: "",
    avatarUrl: "",
  });

  /* ── Load profile ── */
  useEffect(() => {
    if (!user) return;
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("display_name, organization, avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!alive) return;
        if (error) console.warn("[Supabase] profile fetch:", error.message);

        const avatar = await resolveAvatarUrl(data?.avatar_url || "");
        if (!alive) return;

        setProfile({
          name: data?.display_name || user.user_metadata?.display_name || user.user_metadata?.name || "",
          email: user.email || "",
          organization: data?.organization || user.user_metadata?.organization || "",
          avatarUrl: avatar || data?.avatar_url || user.user_metadata?.avatar_url || "",
        });
      } catch (e) {
        console.warn("[Supabase] profile load error:", e?.message || e);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* ── Profile helpers ── */
  const handleChange = (key, value) => setProfile((p) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    setStatus("");
    setLoading(true);
    try {
      if (!user) { setStatus("Please sign in to update your profile."); return; }

      const { error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .upsert({
          id: user.id,
          display_name: profile.name || null,
          organization: profile.organization || null,
          avatar_url: profile.avatarUrl || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });

      if (error) { console.warn("[Supabase]", error.message); setStatus("Unable to save profile right now."); return; }
      setStatus("Profile saved.");
    } catch (e) {
      console.warn("[Supabase]", e?.message || e);
      setStatus("Unable to save profile right now.");
    } finally {
      setLoading(false);
    }
  };

  /* ── Avatar ── */
  const handlePickAvatar = async (event) => {
    setStatus("");
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
      if (!user) { setStatus("Please sign in."); return; }
      setLoading(true);

      const previousPath = getAvatarPathFromUrl(profile.avatarUrl);
      const ext = getExtensionFromMimeType(file.type);
      const filePath = `${user.id}/${Date.now()}.${ext}`;
      const fileBody = await file.arrayBuffer();
      const contentType = file.type || "image/jpeg";

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_AVATAR_BUCKET)
        .upload(filePath, fileBody, { contentType });

      if (uploadError) { console.warn("[Supabase] avatar upload:", uploadError.message); setStatus("Unable to upload avatar."); return; }

      const { data: pub } = supabase.storage.from(SUPABASE_AVATAR_BUCKET).getPublicUrl(filePath);
      const avatarUrl = pub?.publicUrl || "";

      if (previousPath && previousPath !== filePath) {
        await supabase.storage.from(SUPABASE_AVATAR_BUCKET).remove([previousPath]);
      }

      setProfile((p) => ({ ...p, avatarUrl }));
      setStatus("Photo updated. Save changes to confirm.");
    } catch (e) {
      console.warn("[Supabase]", e?.message || e);
      setStatus("Unable to upload avatar.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setLoading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setStatus("");
    setLoading(true);
    try {
      if (!user) { setStatus("Please sign in."); return; }

      const storedPath = getAvatarPathFromUrl(profile.avatarUrl);
      if (storedPath) await supabase.storage.from(SUPABASE_AVATAR_BUCKET).remove([storedPath]);

      const { error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .upsert({ id: user.id, avatar_url: null, updated_at: new Date().toISOString() }, { onConflict: "id" });

      if (error) { setStatus("Unable to remove avatar right now."); return; }
      setProfile((p) => ({ ...p, avatarUrl: "" }));
      setStatus("Photo removed.");
    } catch {
      setStatus("Unable to remove avatar right now.");
    } finally {
      setLoading(false);
    }
  };

  /* ── Password ── */
  const handlePasswordChange = (key, value) => setPasswordForm((p) => ({ ...p, [key]: value }));

  const handleUpdatePassword = async () => {
    setPasswordStatus("");
    if (!user) { setPasswordStatus("Please sign in to update your password."); return; }
    if (!passwordForm.oldPassword) { setPasswordStatus("Old password is required."); return; }
    if (!passwordForm.newPassword) { setPasswordStatus("New password is required."); return; }
    if (!passwordForm.confirmPassword) { setPasswordStatus("Confirm password is required."); return; }
    if (!PASSWORD_REGEX.test(passwordForm.newPassword)) { setPasswordStatus("Password must be at least 8 characters and include uppercase, lowercase, and a number."); return; }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setPasswordStatus("Passwords do not match."); return; }
    if (passwordForm.oldPassword === passwordForm.newPassword) { setPasswordStatus("New password must be different from old password."); return; }

    try {
      setPasswordLoading(true);
      const email = user.email || profile.email;
      if (!email) { setPasswordStatus("Unable to verify your account. Please sign in again."); return; }

      const { data: v, error: vErr } = await supabase.auth.signInWithPassword({ email, password: passwordForm.oldPassword });
      if (vErr || !v?.user || v.user.id !== user.id) { setPasswordStatus("Old password is invalid."); return; }

      const { error } = await supabase.auth.updateUser({ password: passwordForm.newPassword });
      if (error) { console.warn("[Supabase]", error.message); setPasswordStatus(error.message || "Unable to update password right now."); return; }

      setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordStatus("Password updated.");
    } catch (e) {
      console.warn("[Supabase]", e?.message || e);
      setPasswordStatus("Unable to update password right now.");
    } finally {
      setPasswordLoading(false);
    }
  };

  /* ── Render ── */
  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Header */}
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Admin</p>
          <h1 className="text-3xl font-semibold text-slate-900">My profile</h1>
          <p className="text-sm text-slate-500">Update your admin account details.</p>
        </header>

        {/* ── Profile card ── */}
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 md:grid-cols-[auto,1fr]">
            {/* Avatar column */}
            <div className="flex flex-col items-center gap-3">
              <div className="h-28 w-28 overflow-hidden rounded-full border-2 border-sky-200 bg-sky-50">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
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

            {/* Fields column */}
            <div className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="displayName" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Display name</label>
                <input
                  id="displayName"
                  type="text"
                  value={profile.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  placeholder="e.g. Admin user"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Email</label>
                <input
                  id="email"
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full cursor-not-allowed rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="organization" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Organization / lab</label>
                <input
                  id="organization"
                  type="text"
                  value={profile.organization}
                  onChange={(e) => handleChange("organization", e.target.value)}
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
                <p className={`text-sm ${status ? statusTone(status) : "text-slate-500"}`}>
                  {status || "Changes sync to Supabase when saved."}
                </p>
              </div>
            </div>
          </div>
        </article>

        {/* ── Password card ── */}
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-5">
            <header className="space-y-1">
              <h2 className="text-xl font-semibold text-slate-900">Update password</h2>
              <p className="text-sm text-slate-500">Use a strong password to secure your account.</p>
            </header>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="oldPassword" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Old password</label>
                <input
                  id="oldPassword"
                  type="password"
                  autoComplete="current-password"
                  value={passwordForm.oldPassword}
                  onChange={(e) => handlePasswordChange("oldPassword", e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white"
                  disabled={passwordLoading}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="newPassword" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">New password</label>
                <input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.newPassword}
                  onChange={(e) => handlePasswordChange("newPassword", e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white"
                  disabled={passwordLoading}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Confirm password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => handlePasswordChange("confirmPassword", e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-300 focus:bg-white"
                  disabled={passwordLoading}
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">Password must be at least 8 characters and include uppercase, lowercase, and a number.</p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleUpdatePassword}
                disabled={passwordLoading}
                className="rounded-2xl border border-sky-600 bg-sky-600 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {passwordLoading ? "Updating..." : "Update password"}
              </button>
              <p className={`text-sm ${passwordStatus ? statusTone(passwordStatus) : "text-slate-500"}`}>
                {passwordStatus || "Password changes apply immediately after successful update."}
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
