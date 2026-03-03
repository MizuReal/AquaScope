import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "@/lib/AuthContext";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

function hasValidRecoveryParams() {
  if (typeof window === "undefined") {
    return false;
  }

  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search || "");

  const type = hashParams.get("type") || queryParams.get("type");
  const accessToken = hashParams.get("access_token") || queryParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token") || queryParams.get("refresh_token");
  const code = hashParams.get("code") || queryParams.get("code");

  return type === "recovery" && Boolean(accessToken || refreshToken || code);
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [hasRecoveryToken] = useState(() => hasValidRecoveryParams());
  const shouldRedirectBlocked = !authLoading && (!user || !hasRecoveryToken);

  useEffect(() => {
    if (!shouldRedirectBlocked) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      navigate("/", {
        replace: true,
        state: {
          authIntent: "login",
          authNotice: "Reset link is invalid or expired. Please log in and request a new reset email.",
        },
      });
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, shouldRedirectBlocked]);

  const canSubmit = useMemo(() => {
    return !submitting && !authLoading && Boolean(user) && isSupabaseConfigured && hasRecoveryToken;
  }, [authLoading, hasRecoveryToken, submitting, user]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!isSupabaseConfigured || !supabase) {
      setFeedback({
        type: "error",
        message: "Supabase credentials are missing. Password reset is unavailable.",
      });
      return;
    }

    if (!user) {
      setFeedback({
        type: "error",
        message: "Reset link is invalid or expired. Request a new password reset email.",
      });
      return;
    }

    if (!hasRecoveryToken) {
      setFeedback({
        type: "error",
        message: "Reset link is invalid or expired. Open the latest reset email and use that link.",
      });
      return;
    }

    if (!PASSWORD_REGEX.test(password)) {
      setFeedback({
        type: "error",
        message: "Password must be at least 8 characters and include uppercase, lowercase, and a number.",
      });
      return;
    }

    if (password !== confirmPassword) {
      setFeedback({ type: "error", message: "Passwords do not match." });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        throw error;
      }

      setFeedback({ type: "success", message: "Password updated successfully. Redirecting to login..." });
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 900);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error?.message ?? "Unable to update password right now.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-sky-600">AquaScope Access</p>
          <h1 className="text-2xl text-slate-900">Reset your password</h1>
          <p className="text-sm text-slate-500">Set a new password to regain access to your workspace.</p>
        </div>

        {!isSupabaseConfigured ? (
          <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Supabase credentials are missing. Configure auth to continue.
          </p>
        ) : null}

        {!authLoading && !user ? (
          <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Reset link is invalid or expired. Request a new reset email from the login screen.
          </p>
        ) : null}

        {!authLoading && user && !hasRecoveryToken ? (
          <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            This page only works from a valid password reset email link.
          </p>
        ) : null}

        {shouldRedirectBlocked ? (
          <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Redirecting to home/login...
          </p>
        ) : null}

        {feedback ? (
          <p
            className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
              feedback.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
            role="status"
            aria-live="polite"
          >
            {feedback.message}
          </p>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <label className="block">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">New password</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={!canSubmit}
              required
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Confirm password</span>
            <input
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={!canSubmit}
              required
            />
          </label>

          <p className="text-xs text-slate-500">Password must be at least 8 characters and include uppercase, lowercase, and a number.</p>

          <button
            type="submit"
            className={`w-full rounded-full bg-sky-600 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-white transition ${
              canSubmit ? "hover:bg-sky-700" : "opacity-40"
            }`}
            disabled={!canSubmit}
            aria-busy={submitting}
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>

        <div className="mt-5 text-sm text-slate-500">
          Back to <Link className="text-sky-600 hover:text-sky-700" to="/">home</Link>.
        </div>
      </section>
    </main>
  );
}
