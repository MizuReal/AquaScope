"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Lottie from "lottie-react";

import { getUserRole, isAdminRole } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { chatWithCopilot } from "@/lib/api";
import UserSamples from "./user_samples";
import cuteRobotAnim from "../../../public/CuteRobot.json";
import aiAnim from "../../../public/AI.json";

/* ── Real system stat cards ───────────────────────────────── */
const statCards = [
  {
    label: "ML parameters",
    value: "9",
    detail: "pH, hardness, solids, chloramines, sulfate, conductivity, organic carbon, trihalomethanes, turbidity",
    icon: "🧪",
  },
  {
    label: "OCR extraction",
    value: "<6s",
    detail: "Fiducial-aligned form scanning with EasyOCR engine",
    icon: "📄",
  },
  {
    label: "WHO risk levels",
    value: "4",
    detail: "Conformity, Low, Moderate, High / Very High risk bands",
    icon: "⚠️",
  },
  {
    label: "AI model",
    value: "70B",
    detail: "Groq Llama 3.3 for contextual chat & filtration advice",
    icon: "🤖",
  },
];

/* ── Water parameters analyzed by the ML model ────────────── */
const waterParameters = [
  { name: "pH", range: "6.5 – 8.5", unit: "", desc: "Acidity / alkalinity" },
  { name: "Hardness", range: "47 – 323", unit: "mg/L", desc: "Calcium & magnesium" },
  { name: "Solids", range: "320 – 61 227", unit: "ppm", desc: "Total dissolved solids" },
  { name: "Chloramines", range: "1.4 – 13.1", unit: "ppm", desc: "Disinfection level" },
  { name: "Sulfate", range: "129 – 481", unit: "mg/L", desc: "Mineral content" },
  { name: "Conductivity", range: "181 – 753", unit: "μS/cm", desc: "Ionic concentration" },
  { name: "Organic carbon", range: "2.2 – 28.3", unit: "ppm", desc: "Organic matter" },
  { name: "Trihalomethanes", range: "0.7 – 124", unit: "μg/L", desc: "Disinfection byproducts" },
  { name: "Turbidity", range: "1.5 – 6.7", unit: "NTU", desc: "Water clarity" },
];

/* ── Quick actions — real system features ─────────────────── */
const quickActions = [
  {
    title: "Scan a lab form",
    description: "Use OCR to capture water quality data from a printed or handwritten form",
    endpoint: "/ocr/data-card",
    icon: "📷",
  },
  {
    title: "Predict potability",
    description: "Run the gradient-boosted model to check if a water sample is safe to drink",
    endpoint: "/predict/potability",
    icon: "🔬",
  },
  {
    title: "Assess microbial risk",
    description: "Grade bacteria colony counts against WHO thresholds and risk categories",
    endpoint: "/predict/microbial-risk",
    icon: "🦠",
  },
  {
    title: "Ask the AI assistant",
    description: "Get filtration suggestions and plain-language explanations from Llama 3.3",
    endpoint: "/chat/message",
    icon: "💬",
  },
];

/* ── ML pipeline steps ────────────────────────────────────── */
const pipelineSteps = [
  { stage: "Data ingestion", detail: "REST API, OCR, or manual entry", status: "active" },
  { stage: "Fiducial detection", detail: "Auto-align scanned forms with marker recognition", status: "active" },
  { stage: "Feature extraction", detail: "9 water quality parameters normalized for ML", status: "active" },
  { stage: "Potability classifier", detail: "Gradient-boosted model with confidence score", status: "active" },
  { stage: "Microbial risk grading", detail: "WHO threshold mapping for bacteria counts", status: "active" },
  { stage: "LLM interpretation", detail: "Groq Llama 3.3 70B contextual explanation", status: "active" },
];

const configMissing = !supabase || !isSupabaseConfigured;
const CHAT_TABS = {
  WATER: "water_quality",
  DATA: "my_data",
};

const pickDisplayName = (user) => {
  const metadata = user?.user_metadata || {};
  return (
    metadata.display_name ||
    metadata.full_name ||
    metadata.name ||
    user?.email?.split("@")[0] ||
    "User"
  );
};

const pickAvatarUrl = (user) => {
  const metadata = user?.user_metadata || {};
  return metadata.avatar_url || metadata.picture || "";
};

const buildInitials = (name) => {
  const tokens = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "U";
  if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase();
  return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
};

const IconBot = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v3" />
    <circle cx="9" cy="13" r="1" />
    <circle cx="15" cy="13" r="1" />
    <path d="M9 16h6" />
  </svg>
);

const IconWater = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M12 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10z" />
  </svg>
);

const IconData = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M4 19V5" />
    <rect x="6" y="11" width="3" height="8" rx="0.8" />
    <rect x="11" y="8" width="3" height="11" rx="0.8" />
    <rect x="16" y="5" width="3" height="14" rx="0.8" />
  </svg>
);

const IconSend = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M22 2L11 13" />
    <path d="M22 2L15 22l-4-9-9-4z" />
  </svg>
);

const IconClose = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M6 6l12 12" />
    <path d="M18 6l-12 12" />
  </svg>
);

export default function DashboardPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [checking, setChecking] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [userStats, setUserStats] = useState({ scans: 0, predictions: 0 });
  const [displayName, setDisplayName] = useState("User");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatTab, setChatTab] = useState(CHAT_TABS.WATER);
  const [chatModalActive, setChatModalActive] = useState(false);

  useEffect(() => {
    if (configMissing) return;

    let isMounted = true;

    const bootstrap = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;
      if (error) {
        setAuthError("Unable to verify your session. Please try logging in again.");
        setChecking(false);
        return;
      }
      if (!data?.session) {
        setRedirecting(true);
        router.replace("/");
        return;
      }

      setDisplayName(pickDisplayName(data.session.user));
      setAvatarUrl(pickAvatarUrl(data.session.user));
      setAvatarFailed(false);

      try {
        const role = await getUserRole(data.session.user.id);
        if (!isMounted) return;

        if (isAdminRole(role)) {
          setRedirecting(true);
          router.replace("/admin/dashboard");
          return;
        }
      } catch {
        /* role lookup failure should not block regular dashboard */
      }

      setAuthReady(true);
      setChecking(false);

      /* Fetch real user sample counts */
      try {
        const userId = data.session.user.id;
        const { count: fieldCount } = await supabase
          .from("field_samples")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);
        const { count: containerCount } = await supabase
          .from("container_samples")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);
        if (isMounted) {
          setUserStats({
            scans: (fieldCount || 0) + (containerCount || 0),
            predictions: fieldCount || 0,
          });
        }
      } catch {
        /* non-critical — dashboard still works with 0 counts */
      }
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setAuthReady(false);
        setRedirecting(true);
        router.replace("/");
      } else {
        setAuthReady(true);
        setDisplayName(pickDisplayName(session.user));
        setAvatarUrl(pickAvatarUrl(session.user));
        setAvatarFailed(false);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to web/.env.local so we can secure the dashboard route.
          </p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">Return home</Link>
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
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">Return home</Link>
        </div>
      </div>
    );
  }

  if (checking || !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="space-y-4">
          <p className="text-xl font-semibold">{redirecting ? "Redirecting you to login" : "Verifying your session"}…</p>
          <p className="text-sm text-slate-500">Hang tight while we secure your workspace.</p>
        </div>
      </div>
    );
  }

  const handleSendChat = async () => {
    const message = chatInput.trim();
    if (!message || chatLoading) {
      return;
    }

    const nextHistory = [...chatHistory, { role: "user", text: message }];
    setChatHistory(nextHistory);
    setChatInput("");
    setChatLoading(true);
    setChatError("");

    const tabContext =
      chatTab === CHAT_TABS.WATER
        ? {
            focus: "water_quality",
            guidance:
              "Focus on water quality interpretation, filtration suggestions, risk-level explanation, and safe follow-up actions.",
            water_parameters: waterParameters,
          }
        : {
            focus: "my_data",
            guidance:
              "Focus on the user's activity and trends, summarize what their dashboard metrics imply, and suggest next steps based on personal data.",
            dashboard_metrics: userStats,
            user_name: displayName,
          };

    try {
      const payload = await chatWithCopilot(
        {
          source: "web-dashboard",
          user_stats: userStats,
          context: tabContext,
        },
        nextHistory,
        message,
      );

      setChatHistory((prev) => [...prev, { role: "assistant", text: payload.reply || "No response received." }]);
    } catch (error) {
      const messageText = error?.message || "Unable to contact chatbot right now.";
      setChatError(messageText);
      setChatHistory((prev) => [...prev, { role: "assistant", text: `Error: ${messageText}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const openChatModal = () => {
    setChatOpen(true);
    setTimeout(() => setChatModalActive(true), 10);
  };

  const closeChatModal = () => {
    setChatModalActive(false);
    setTimeout(() => setChatOpen(false), 220);
  };

  const handleChatTabChange = (nextTab) => {
    if (nextTab === chatTab) return;
    setChatTab(nextTab);
    setChatHistory([]);
    setChatInput("");
    setChatError("");
  };

  const promptSuggestions =
    chatTab === CHAT_TABS.WATER
      ? [
          "Explain safe pH and turbidity ranges in simple terms.",
          "What filtration setup is best for microbial risk?",
          "How should I interpret watch vs unsafe risk levels?",
        ]
      : [
          "Summarize my current scan and prediction activity.",
          "What should I do next based on my data trends?",
          "Give me a short action plan for this week.",
        ];

  return (
    <section className="flex-1 bg-slate-100 px-6 py-10 lg:px-12">
      {/* ── Header ──────────────────────────────────────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600">Welcome back, {displayName}!</p>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Dashboard</p>
          <h1 className="text-3xl font-semibold text-slate-800">Water Quality Control Room</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-full border border-slate-300 bg-white px-3 py-2">
            {avatarUrl && !avatarFailed ? (
              <img
                src={avatarUrl}
                alt={`${displayName} profile picture`}
                className="h-9 w-9 rounded-full border border-slate-200 object-cover"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-xs font-semibold text-sky-700">
                {buildInitials(displayName)}
              </span>
            )}
            <div className="leading-tight">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Signed in</p>
              <p className="text-sm font-medium text-slate-700">{displayName}</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm text-slate-600">
            Your scans: <strong className="text-sky-600">{userStats.scans}</strong>
          </span>
          <span className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm text-slate-600">
            Predictions: <strong className="text-sky-600">{userStats.predictions}</strong>
          </span>
        </div>
      </header>

      {/* ── AI Chatbot Launcher ─────────────────────────── */}
      <div className="mt-8 grid gap-5 rounded-2xl border border-slate-300 bg-white p-5 shadow-sm lg:grid-cols-[220px_1fr]">
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3">
          <Lottie animationData={cuteRobotAnim} loop autoplay className="h-44 w-full" />
        </div>
        <div className="flex flex-col justify-center gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-600">AI Assistant</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-800">Chat with AquaScope Copilot</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Personalized support for your water analysis workflow — ask questions, interpret results, and get next-step guidance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
              onClick={openChatModal}
            >
              <span className="h-6 w-6">
                <Lottie animationData={aiAnim} loop autoplay className="h-6 w-6" />
              </span>
              Start a conversation
            </button>
          </div>
        </div>
      </div>

      {chatOpen ? (
        <div
          className={`fixed inset-0 z-50 flex h-[100dvh] items-end justify-center overflow-y-auto bg-slate-900/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-opacity duration-200 sm:items-center ${
            chatModalActive ? "opacity-100" : "opacity-0"
          }`}
          onClick={closeChatModal}
        >
          <div
            className={`my-auto w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-b from-white to-sky-50/40 p-5 shadow-2xl transition-all duration-200 ${
              chatModalActive ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl border border-sky-200 bg-sky-50 p-1">
                  <Lottie animationData={aiAnim} loop autoplay className="h-full w-full" />
                </div>
                <div>
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><IconBot className="h-4 w-4" />AquaScope Copilot</p>
                  <p className="text-xs text-slate-500">Hi {displayName}, I can help with your water results and dashboard activity.</p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
                onClick={closeChatModal}
              >
                <IconClose className="h-3.5 w-3.5" />
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-left text-sm font-medium transition ${
                  chatTab === CHAT_TABS.WATER
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                onClick={() => handleChatTabChange(CHAT_TABS.WATER)}
              >
                <IconWater className="h-4 w-4" />
                Ask about water quality
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-left text-sm font-medium transition ${
                  chatTab === CHAT_TABS.DATA
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                onClick={() => handleChatTabChange(CHAT_TABS.DATA)}
              >
                <IconData className="h-4 w-4" />
                Ask about my data
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {promptSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-sky-50 hover:text-sky-700"
                  onClick={() => setChatInput(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="mt-4 h-[min(20rem,38dvh)] space-y-2 overflow-y-auto rounded-2xl border border-sky-100 bg-white/90 p-4">
              {chatHistory.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {chatTab === CHAT_TABS.WATER
                    ? "Ask about risk levels, threshold meaning, filtration options, and interpretation of water parameters."
                    : "Ask for summaries and recommendations based on your dashboard activity and prediction history."}
                </div>
              ) : (
                chatHistory.map((messageItem, index) => (
                  <div
                    key={`${messageItem.role}-${index}`}
                    className={`max-w-[85%] rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                      messageItem.role === "user"
                        ? "ml-auto border-sky-300 bg-sky-100 text-slate-800"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <div className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                      {messageItem.role === "user" ? <IconData className="h-3 w-3" /> : <IconBot className="h-3 w-3" />}
                      {messageItem.role === "user" ? "You" : "Copilot"}
                    </div>
                    <p>{messageItem.text}</p>
                  </div>
                ))
              )}

              {chatLoading ? (
                <div className="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                  <div className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    <IconBot className="h-3 w-3" />
                    Copilot
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-sky-400" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-sky-400 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-sky-400 [animation-delay:240ms]" />
                    <span className="ml-1 text-xs">Thinking...</span>
                  </div>
                </div>
              ) : null}
            </div>

            {chatError ? (
              <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {chatError}
              </p>
            ) : null}

            <div className="mt-4 flex items-end gap-3">
              <textarea
                className="min-h-[88px] flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none ring-sky-300 focus:ring"
                placeholder={
                  chatTab === CHAT_TABS.WATER
                    ? "Ask about filtration methods, risk interpretation, or safe water actions..."
                    : "Ask about your trends, usage summary, and recommended next steps..."
                }
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
              />
              <button
                type="button"
                className={`inline-flex min-w-[116px] items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition ${
                  chatLoading || !chatInput.trim()
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-sky-600 text-white hover:bg-sky-700"
                }`}
                onClick={handleSendChat}
                disabled={chatLoading || !chatInput.trim()}
              >
                {chatLoading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  <>
                    <IconSend className="h-4 w-4" />
                    Send message
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── System stat cards ───────────────────────────── */}
      <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <article key={card.label} className="space-y-3 rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{card.icon}</span>
              <p className="text-xs uppercase tracking-[0.35em] text-sky-600">{card.label}</p>
            </div>
            <p className="text-3xl font-semibold text-slate-800">{card.value}</p>
            <p className="text-xs text-slate-500 leading-relaxed">{card.detail}</p>
          </article>
        ))}
      </div>

      {/* ── Quick Actions + Water Parameters ────────────── */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Quick Actions */}
        <article className="flex flex-col gap-6 rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-600">Quick actions</p>
            <p className="text-sm text-slate-500">Core system capabilities you can run right now</p>
          </div>
          <div className="space-y-3">
            {quickActions.map((action, index) => (
              <div
                key={action.title}
                className={`rounded-2xl border px-5 py-4 transition hover:-translate-y-0.5 hover:shadow-sm ${
                  index === 1
                    ? "border-emerald-200 bg-emerald-50"
                    : index === 2
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 rounded-xl border border-slate-200 bg-white px-2 py-1 text-2xl">
                    {action.icon}
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{action.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{action.description}</p>
                    <p className="mt-2 font-mono text-xs text-slate-500">{action.endpoint}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        {/* Water parameters */}
        <article className="flex flex-col gap-6 rounded-2xl border border-sky-300 bg-sky-50 p-6 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-600">Water quality parameters</p>
            <p className="text-sm text-slate-500">9 features analyzed by the potability model</p>
          </div>
          <div className="space-y-2">
            {waterParameters.map((param) => (
              <div
                key={param.name}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{param.name}</p>
                  <p className="text-xs text-slate-400">{param.desc}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs text-slate-600">{param.range}</p>
                  {param.unit && (
                    <p className="text-xs text-slate-400">{param.unit}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      {/* ── ML Pipeline ─────────────────────────────────── */}
      <div className="mt-10">
        <article className="space-y-6 rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-600">ML pipeline</p>
            <p className="text-sm text-slate-500">End-to-end processing stages in AquaScope</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pipelineSteps.map((step, i) => (
              <div
                key={step.stage}
                className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-600">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-slate-900">{step.stage}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      {/* ── User Samples ────────────────────────────────── */}
      <div className="mt-10">
        <UserSamples />
      </div>
    </section>
  );
}
