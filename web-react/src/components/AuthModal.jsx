"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const enableAuthDebugLogs =
  import.meta.env.VITE_AUTH_DEBUG_LOGS === "true" ||
  import.meta.env.VITE_ADMIN_DEBUG_LOGS === "true" ||
  Boolean(import.meta.env.DEV);

function authDebugLog(event, payload = {}) {
  if (!enableAuthDebugLogs) {
    return;
  }
  console.debug("[auth-debug]", event, payload);
}

function maskEmail(email = "") {
  const trimmed = String(email || "").trim();
  if (!trimmed.includes("@")) return "";
  const [local, domain] = trimmed.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 0))}@${domain}`;
}

function toErrorDebugPayload(error) {
  return {
    name: error?.name,
    message: error?.message,
    status: error?.status,
    code: error?.code,
    cause: error?.cause,
    stack: error?.stack,
  };
}

function buildSignupRedirectUrl() {
  if (typeof window === "undefined") {
    return undefined;
  }
  return `${window.location.origin}/?signup=success`;
}

function buildPasswordResetRedirectUrl() {
  if (typeof window === "undefined") {
    return undefined;
  }
  return `${window.location.origin}/reset-password`;
}

function buildOAuthRedirectUrl() {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.location.origin;
}

const formFields = {
  login: [
    { label: "Email", type: "email", name: "email", autoComplete: "email" },
    { label: "Password", type: "password", name: "password", autoComplete: "current-password" },
  ],
  register: [
    { label: "Full name", type: "text", name: "name", autoComplete: "name" },
    { label: "Organization", type: "text", name: "organization", autoComplete: "organization" },
    { label: "Work email", type: "email", name: "email", autoComplete: "email" },
    { label: "Password", type: "password", name: "password", autoComplete: "new-password" },
    { label: "Confirm password", type: "password", name: "confirmPassword", autoComplete: "new-password" },
  ],
};

const defaultFormState = () => ({
  login: { email: "", password: "" },
  register: { name: "", organization: "", email: "", password: "", confirmPassword: "" },
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// ─── Inline SVG icons (no external dependency) ───────────────────────────────
const ICONS = {
  name: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  organization: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="14" rx="1" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
      <line x1="12" y1="12" x2="12" y2="12.01" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </svg>
  ),
  email: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 8l10 7 10-7" />
    </svg>
  ),
  password: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  ),
  confirmPassword: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <path d="M9 16l2 2 4-4" />
    </svg>
  ),
  eyeOn: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
};

// ─── Icon-prefixed field input with optional password eye toggle ──────────────
function FieldInput({ field, value, onChange, disabled }) {
  const [visible, setVisible] = useState(false);
  const isPassword = field.type === "password";
  const inputType = isPassword && visible ? "text" : field.type;

  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.3em] text-slate-500">{field.label}</span>
      <div className="relative mt-2 flex items-center">
        <span className="pointer-events-none absolute left-3.5 text-slate-400">
          {ICONS[field.name] || ICONS.email}
        </span>
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-9 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
          type={inputType}
          name={field.name}
          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
          autoComplete={field.autoComplete}
          required
          value={value ?? ""}
          onChange={onChange}
          disabled={disabled}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute right-3.5 text-slate-400 transition hover:text-slate-600"
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? ICONS.eyeOff : ICONS.eyeOn}
          </button>
        )}
      </div>
    </label>
  );
}

export default function AuthModal({ open, mode = "login", onClose, onModeChange, noticeMessage = "" }) {
  const navigate = useNavigate();
  const [formState, setFormState] = useState(defaultFormState);
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setSendingReset(false);
      setOauthLoading(false);
      setFeedback(null);
      setFormState(defaultFormState());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const fields = formFields[mode];
  const currentValues = formState[mode];
  const disableSubmit = loading || sendingReset || oauthLoading || !isSupabaseConfigured;

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        [name]: value,
      },
    }));
  };

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleModeSwitch = (targetMode) => {
    if (mode === targetMode) {
      return;
    }
    setFeedback(null);
    setLoading(false);
    setSendingReset(false);
    setOauthLoading(false);
    onModeChange?.(targetMode);
  };

  const handleGoogleSignIn = async () => {
    authDebugLog("oauth:google:start", {
      mode,
      isSupabaseConfigured,
      hasSupabaseClient: Boolean(supabase),
      hasSupabaseUrl: Boolean(import.meta.env.VITE_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY),
    });

    if (!supabase) {
      setFeedback({
        type: "error",
        message: "Supabase credentials missing. Google sign in is unavailable.",
      });
      return;
    }

    setOauthLoading(true);
    setFeedback(null);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildOAuthRedirectUrl(),
        },
      });

      if (error) {
        authDebugLog("oauth:google:error", toErrorDebugPayload(error));
        throw error;
      }

      authDebugLog("oauth:google:redirect", {
        provider: "google",
        hasUrl: Boolean(data?.url),
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error?.message ?? "Unable to start Google sign in right now.",
      });
      setOauthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!supabase) {
      setFeedback({
        type: "error",
        message: "Supabase credentials missing. Password reset is unavailable.",
      });
      return;
    }

    const email = String(formState.login.email || "").trim();
    if (!email) {
      setFeedback({ type: "error", message: "Enter your email first, then tap Forgot password." });
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setFeedback({ type: "error", message: "Enter a valid email address first." });
      return;
    }

    setSendingReset(true);
    setFeedback(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildPasswordResetRedirectUrl(),
      });

      if (error) {
        throw error;
      }

      setFeedback({
        type: "success",
        message: "If this email is registered, a password reset link has been sent.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error?.message ?? "Unable to send password reset email right now.",
      });
    } finally {
      setSendingReset(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    authDebugLog("submit:start", {
      mode,
      isSupabaseConfigured,
      hasSupabaseClient: Boolean(supabase),
      hasSupabaseUrl: Boolean(import.meta.env.VITE_PUBLIC_SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY),
      email: maskEmail(currentValues?.email),
    });

    if (!supabase) {
      authDebugLog("submit:blocked-missing-client", {
        mode,
        hasSupabaseUrl: Boolean(import.meta.env.VITE_PUBLIC_SUPABASE_URL),
        hasSupabaseAnonKey: Boolean(import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY),
      });
      setFeedback({
        type: "error",
        message: "Supabase credentials missing. Set VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to enable auth.",
      });
      return;
    }

    const payload = currentValues;
    const email = String(payload.email || "").trim();
    const password = String(payload.password || "");

    if (!email || !password) {
      setFeedback({ type: "error", message: "Email and password are required." });
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setFeedback({ type: "error", message: "Enter a valid email address." });
      return;
    }

    if (mode === "register") {
      const fullName = String(payload.name || "").trim();
      const organization = String(payload.organization || "").trim();
      const confirmPassword = String(payload.confirmPassword || "");

      if (!fullName) {
        setFeedback({ type: "error", message: "Full name is required." });
        return;
      }

      if (!organization) {
        setFeedback({ type: "error", message: "Organization is required." });
        return;
      }

      if (!PASSWORD_REGEX.test(password)) {
        setFeedback({
          type: "error",
          message: "Password must be at least 8 characters and include uppercase, lowercase, and a number.",
        });
        return;
      }

      if (!confirmPassword) {
        setFeedback({ type: "error", message: "Confirm password is required." });
        return;
      }

      if (password !== confirmPassword) {
        setFeedback({ type: "error", message: "Passwords do not match." });
        return;
      }
    }

    setLoading(true);
    setFeedback(null);

    let redirectPath = "/dashboard";

    try {
      if (mode === "login") {
        authDebugLog("login:request", {
          email: maskEmail(payload.email),
        });
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          authDebugLog("login:error", toErrorDebugPayload(error));
          throw error;
        }

        authDebugLog("login:success", {
          hasSession: Boolean(data?.session),
          userId: data?.user?.id || null,
        });

        const userId = data?.user?.id;
        if (userId) {
          const role = await getUserRole(userId);
          authDebugLog("login:role-resolved", { userId, role });
          redirectPath = isAdminRole(role) ? "/admin/dashboard" : "/dashboard";
        }

        setFeedback({ type: "success", message: "Authenticated. Redirecting you to the dashboard..." });
      } else {
        authDebugLog("register:request", {
          email: maskEmail(payload.email),
          hasFullName: Boolean(payload.name),
          hasOrganization: Boolean(payload.organization),
        });

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: buildSignupRedirectUrl(),
            data: {
              full_name: String(payload.name || "").trim(),
              organization: String(payload.organization || "").trim(),
            },
          },
        });

        if (error) {
          const lowered = String(error?.message || "").toLowerCase();
          if (lowered.includes("already registered") || lowered.includes("already exists")) {
            setFeedback({ type: "error", message: "An account with this email already exists. Please log in instead." });
            authDebugLog("register:duplicate-email-error", toErrorDebugPayload(error));
            return;
          }
          authDebugLog("register:error", toErrorDebugPayload(error));
          throw error;
        }

        const hasIdentities = Array.isArray(data?.user?.identities) && data.user.identities.length > 0;
        if (!hasIdentities) {
          setFeedback({ type: "error", message: "An account with this email already exists. Please log in instead." });
          authDebugLog("register:duplicate-email-soft", {
            userId: data?.user?.id || null,
            identities: Array.isArray(data?.user?.identities) ? data.user.identities.length : null,
          });
          return;
        }

        authDebugLog("register:success", {
          hasSession: Boolean(data?.session),
          userId: data?.user?.id || null,
          identities: Array.isArray(data?.user?.identities) ? data.user.identities.length : null,
        });
        setFeedback({ type: "success", message: "Account created. Check your inbox to confirm access." });
      }

      setTimeout(() => {
        onClose?.();
        setFormState(defaultFormState());
        if (mode === "login") {
          navigate(redirectPath, { replace: true });
        }
      }, 800);
    } catch (error) {
      authDebugLog("submit:catch", {
        mode,
        ...toErrorDebugPayload(error),
      });
      setFeedback({
        type: "error",
        message: error?.message ?? "Unable to complete the request right now.",
      });
    } finally {
      authDebugLog("submit:finally", { mode, loading: false });
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-panel">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-sky-600">AquaScope Access</p>
            <h5 className="text-2xl text-slate-900">{mode === "login" ? "Welcome back" : "Create an operator account"}</h5>
          </div>
          <button
            type="button"
            aria-label="Close authentication modal"
            className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-100"
            onClick={onClose}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="mt-6 flex gap-2 rounded-full border border-slate-200 bg-slate-50 p-1 text-xs uppercase tracking-[0.3em] text-slate-600">
          <button
            className={`flex-1 rounded-full px-4 py-2 transition ${mode === "login" ? "bg-sky-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            type="button"
            onClick={() => handleModeSwitch("login")}
          >
            Login
          </button>
          <button
            className={`flex-1 rounded-full px-4 py-2 transition ${mode === "register" ? "bg-sky-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            type="button"
            onClick={() => handleModeSwitch("register")}
          >
            Register
          </button>
        </div>

        {noticeMessage ? (
          <p className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-700" role="status" aria-live="polite">
            {noticeMessage}
          </p>
        ) : null}

        {feedback && (
          <p
            className={`mt-4 rounded-2xl border px-4 py-3 text-xs ${
              feedback.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
            role="status"
            aria-live="polite"
          >
            {feedback.message}
          </p>
        )}

        <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
          {fields.map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              value={currentValues[field.name]}
              onChange={handleInputChange}
              disabled={loading || oauthLoading}
            />
          ))}
          {mode === "register" && (
            <p className="text-xs text-slate-400">
              Password must be at least 8 characters and include uppercase, lowercase, and a number.
            </p>
          )}
          {mode === "login" ? (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 bg-white text-sky-600 focus:ring-sky-200" />
                Keep me signed in
              </label>
              <button
                type="button"
                className="text-sky-600 hover:text-sky-700 disabled:opacity-50"
                onClick={handleForgotPassword}
                disabled={loading || sendingReset || oauthLoading}
              >
                {sendingReset ? "Sending..." : "Forgot password?"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">By registering you agree to AquaScope platform terms and data policy.</p>
          )}

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
            <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow-md active:scale-[0.98] disabled:opacity-50"
            onClick={handleGoogleSignIn}
            disabled={loading || sendingReset || oauthLoading || !isSupabaseConfigured}
          >
            {oauthLoading ? (
              <svg className="h-4 w-4 animate-spin text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            <span>{oauthLoading ? "Redirecting..." : "Continue with Google"}</span>
          </button>

          <button
            type="submit"
            className={`w-full rounded-full bg-sky-600 py-3 text-sm font-semibold uppercase tracking-[0.4em] text-white shadow-lg shadow-sky-600/25 transition ${
              disableSubmit ? "opacity-40" : "hover:bg-sky-700"
            }`}
            disabled={disableSubmit}
            aria-busy={loading}
          >
            {loading ? "Processing..." : mode === "login" ? "Access dashboard" : "Create workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}
