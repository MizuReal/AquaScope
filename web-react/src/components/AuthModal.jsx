"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

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
  ],
};

const defaultFormState = () => ({
  login: { email: "", password: "" },
  register: { name: "", organization: "", email: "", password: "" },
});

export default function AuthModal({ open, mode = "login", onClose, onModeChange, noticeMessage = "" }) {
  const navigate = useNavigate();
  const [formState, setFormState] = useState(defaultFormState);
  const [loading, setLoading] = useState(false);
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
      setFeedback(null);
      setFormState(defaultFormState());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const fields = formFields[mode];
  const currentValues = formState[mode];
  const disableSubmit = loading || !isSupabaseConfigured;

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
    onModeChange?.(targetMode);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!supabase) {
      setFeedback({
        type: "error",
        message: "Supabase credentials missing. Set VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to enable auth.",
      });
      return;
    }

    const payload = currentValues;
    if (!payload.email || !payload.password) {
      setFeedback({ type: "error", message: "Email and password are required." });
      return;
    }

    setLoading(true);
    setFeedback(null);

    let redirectPath = "/dashboard";

    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: payload.email.trim(),
          password: payload.password,
        });
        if (error) throw error;

        const userId = data?.user?.id;
        if (userId) {
          const role = await getUserRole(userId);
          redirectPath = isAdminRole(role) ? "/admin/dashboard" : "/dashboard";
        }

        setFeedback({ type: "success", message: "Authenticated. Redirecting you to the dashboard..." });
      } else {
        const { error } = await supabase.auth.signUp({
          email: payload.email.trim(),
          password: payload.password,
          options: {
            data: {
              full_name: payload.name,
              organization: payload.organization,
            },
          },
        });
        if (error) throw error;
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
      setFeedback({
        type: "error",
        message: error?.message ?? "Unable to complete the request right now.",
      });
    } finally {
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
            <label key={field.name} className="block text-sm text-slate-700">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">{field.label}</span>
              <input
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
                type={field.type}
                name={field.name}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                autoComplete={field.autoComplete}
                required
                value={currentValues[field.name] ?? ""}
                onChange={handleInputChange}
                disabled={loading}
              />
            </label>
          ))}
          {mode === "login" ? (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 bg-white text-sky-600 focus:ring-sky-200" />
                Keep me signed in
              </label>
              <button type="button" className="text-sky-600 hover:text-sky-700">
                Forgot password?
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">By registering you agree to AquaScope platform terms and data policy.</p>
          )}
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
