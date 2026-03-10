import { Link, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import Lottie from "lottie-react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import ForumNotificationsModal from "@/components/forum/ForumNotificationsModal";
import { useForumNotifications } from "@/hooks/useForumNotifications";
import { chatWithCopilot } from "@/lib/api";
import { CHAT_TABS, buildCopilotChatAnalysis, fetchCopilotUserSnapshot } from "@/lib/copilotContext";
import cuteRobotAnim from "@/assets/lottie/CuteRobot.json";
import aiAnim from "@/assets/lottie/AI.json";
import forumAnim from "@/assets/lottie/forumanim.json";

const pipelineSteps = [
  { stage: "Data ingestion", detail: "REST API, OCR, or manual entry" },
  { stage: "Fiducial detection", detail: "Auto-align scanned forms with marker recognition" },
  { stage: "Feature extraction", detail: "9 water quality parameters normalized for ML" },
  { stage: "Potability classifier", detail: "Random forest model with potability score" },
  { stage: "Microbial risk grading", detail: "WHO threshold mapping for bacteria counts" },
  { stage: "LLM interpretation", detail: "Groq Llama 3.3 70B contextual explanation" },
];

const configMissing = !supabase || !isSupabaseConfigured;
const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";
const CONTAINER_SCANS_TABLE_CANDIDATES = [
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE,
  import.meta.env.VITE_PUBLIC_CONTAINER_SAMPLES_TABLE,
  "container_scans",
  "container_samples",
].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);

const MISSING_RELATION_ERROR_CODE = "42P01";
const MISSING_SCHEMA_ERROR_CODE = "3F000";

const isMissingRelationError = (error) =>
  error?.code === MISSING_RELATION_ERROR_CODE || error?.code === MISSING_SCHEMA_ERROR_CODE;

/* Fetch last 5 valid moss scans (LightMoss | MediumMoss | HeavyMoss) */
const MOSS_CLASSES = ["LightMoss", "MediumMoss", "HeavyMoss"];

const fetchRecentMossScans = async (userId) => {
  for (const table of CONTAINER_SCANS_TABLE_CANDIDATES) {
    const { data, error } = await supabase
      .from(table)
      .select("id, predicted_class, confidence, image_uri, created_at")
      .eq("user_id", userId)
      .eq("is_valid", true)
      .in("predicted_class", MOSS_CLASSES)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!error) return data || [];
    if (isMissingRelationError(error)) continue;
    break;
  }
  return [];
};

const resolveAvatarUrl = async (rawUrlOrPath) => {
  if (!rawUrlOrPath) return "";
  // If it's already a fully-qualified URL, return as-is
  console.debug('[avatar] resolveAvatarUrl input:', rawUrlOrPath);
  if (/^https?:\/\//i.test(rawUrlOrPath)) {
    console.debug('[avatar] input is full URL, returning as-is');
    return rawUrlOrPath;
  }
  // If it contains the bucket segment, extract path
  const marker = `/${SUPABASE_AVATAR_BUCKET}/`;
  let path = rawUrlOrPath;
  const idx = rawUrlOrPath.indexOf(marker);
  if (idx !== -1) path = rawUrlOrPath.slice(idx + marker.length);

  try {
    const { data } = supabase.storage.from(SUPABASE_AVATAR_BUCKET).getPublicUrl(path);
    console.debug('[avatar] getPublicUrl result:', data);
    return data?.publicUrl || "";
  } catch (e) {
    console.error('[avatar] resolveAvatarUrl error:', e);
    return "";
  }
};

/* Strip residual markdown symbols from LLM replies */
const formatCopilotText = (text = "") =>
  String(text)
    .replace(/\r\n/g, "\n")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "\u2022 ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* ── Moss class display metadata (mirrored from ContainerScanPage) ── */
const MOSS_META = {
  LightMoss:  { label: "Light Moss",  bg: "bg-yellow-50",  border: "border-yellow-300",  text: "text-yellow-700",  dot: "bg-yellow-400" },
  MediumMoss: { label: "Medium Moss", bg: "bg-orange-50",  border: "border-orange-300",  text: "text-orange-700",  dot: "bg-orange-400" },
  HeavyMoss:  { label: "Heavy Moss",  bg: "bg-red-50",     border: "border-red-300",     text: "text-red-700",    dot: "bg-red-500"   },
};

const pickDisplayName = (user) => {
  const m = user?.user_metadata || {};
  return m.display_name || m.full_name || m.name || user?.email?.split("@")[0] || "User";
};
const pickAvatarUrl = (user) => {
  const m = user?.user_metadata || {};
  return m.avatar_url || m.picture || "";
};
const buildInitials = (name) => {
  const t = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!t.length) return "U";
  if (t.length === 1) return t[0][0].toUpperCase();
  return `${t[0][0]}${t[1][0]}`.toUpperCase();
};
const formatRelativeTime = (v) => {
  if (!v) return "";
  const ts = new Date(v).getTime();
  if (Number.isNaN(ts)) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

/* ── Inline SVG icon components ───────────────────────────── */
const IconBot = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v3" /><circle cx="9" cy="13" r="1" /><circle cx="15" cy="13" r="1" /><path d="M9 16h6" /></svg>
);
const IconWater = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M12 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10z" /></svg>
);
const IconData = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M4 19V5" /><rect x="6" y="11" width="3" height="8" rx="0.8" /><rect x="11" y="8" width="3" height="11" rx="0.8" /><rect x="16" y="5" width="3" height="14" rx="0.8" /></svg>
);
const IconSend = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4z" /></svg>
);
const IconClose = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M6 6l12 12" /><path d="M18 6l-12 12" /></svg>
);
const IconSpark = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m6.5 6.5 2.8 2.8" /><path d="m14.7 14.7 2.8 2.8" /><path d="m17.5 6.5-2.8 2.8" /><path d="m9.3 14.7-2.8 2.8" /></svg>
);
const IconUsers = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.5" /><path d="M14.5 19a4.5 4.5 0 0 1 6 0" /></svg>
);
const IconClock = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const IconPhone = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M10.5 5.5h3" /><circle cx="12" cy="18.3" r="0.7" fill="currentColor" stroke="none" /></svg>
);
const IconDownload = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M12 4v10" /><path d="m8.5 10.5 3.5 3.5 3.5-3.5" /><path d="M5 19h14" /></svg>
);
const IconCamera = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.1-1.6a1.8 1.8 0 0 1 1.5-.8h1.8a1.8 1.8 0 0 1 1.5.8L15.5 6h2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" /><circle cx="12" cy="12.5" r="3.5" /></svg>
);
const IconSun = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><circle cx="12" cy="12" r="4" /><path d="M12 2.8v2.3" /><path d="M12 18.9v2.3" /><path d="M2.8 12h2.3" /><path d="M18.9 12h2.3" /><path d="m5.5 5.5 1.6 1.6" /><path d="m16.9 16.9 1.6 1.6" /><path d="m18.5 5.5-1.6 1.6" /><path d="m7.1 16.9-1.6 1.6" /></svg>
);
const IconChevron = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="m6 9 6 6 6-6" /></svg>
);
const IconBell = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 18H5a2 2 0 0 1-2-2v-1.3c0-.7.2-1.4.6-2l1-1.4A4.8 4.8 0 0 0 5.5 8V7a4.5 4.5 0 1 1 9 0v1a4.8 4.8 0 0 0 .9 2.9l1 1.4c.4.6.6 1.3.6 2V16a2 2 0 0 1-2 2h0Z" />
    <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
  </svg>
);

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user: sessionUser } = useAuth();
  const [userStats, setUserStats] = useState({ scans: 0, predictions: 0 });
  const [displayName, setDisplayName] = useState("User");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [recentMossScans, setRecentMossScans] = useState([]);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatTab, setChatTab] = useState(CHAT_TABS.WATER);
  const [chatModalActive, setChatModalActive] = useState(false);
  const [lastSample, setLastSample] = useState(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialModalActive, setTutorialModalActive] = useState(false);
  const [forumSpotlight, setForumSpotlight] = useState(null);
  const [spotlightAvatarFailed, setSpotlightAvatarFailed] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const {
    notifications,
    notificationsLoading,
    notificationsError,
    notificationsBusyId,
    unreadNotificationsCount,
    refreshNotifications,
    markNotificationAsRead,
  } = useForumNotifications({
    sessionUserId: sessionUser?.id || "",
    profilesTable: SUPABASE_PROFILES_TABLE,
    normalizeAvatarUrl: resolveAvatarUrl,
  });

  const hydrateIdentity = useCallback(async (user, isActive = () => true) => {
    if (!user) return;

    const metadataName = pickDisplayName(user);
    const metadataAvatar = pickAvatarUrl(user);
    if (isActive()) {
      setDisplayName(metadataName);
      setAvatarFailed(false);
    }

    const resolvedMetaAvatar = await resolveAvatarUrl(metadataAvatar);
    if (isActive()) {
      setAvatarUrl(resolvedMetaAvatar || metadataAvatar || "");
    }

    try {
      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("avatar_url, display_name")
        .eq("id", user.id)
        .maybeSingle();

      if (!isActive() || profileResult.error || !profileResult.data) {
        return;
      }

      if (profileResult.data.display_name) {
        setDisplayName(profileResult.data.display_name);
      }

      if (profileResult.data.avatar_url) {
        const resolved = await resolveAvatarUrl(profileResult.data.avatar_url);
        if (isActive()) {
          setAvatarUrl(resolved || profileResult.data.avatar_url);
        }
      }
    } catch {
    }
  }, []);

  /* ── Auth bootstrap ─────────────────────────────────────── */
  /* ── Identity hydration ────────────────────────────────── */
  useEffect(() => {
    if (!sessionUser) return;
    let alive = true;
    hydrateIdentity(sessionUser, () => alive);
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.id, hydrateIdentity]);

  /* ── Data fetching ──────────────────────────────────────── */
  useEffect(() => {
    if (!sessionUser || !supabase) return;
    let alive = true;

    (async () => {
      try {
        const uid = sessionUser.id;
        const snapshot = await fetchCopilotUserSnapshot(uid);
        if (alive) {
          setUserStats(snapshot.userStats);
          setLastSample(snapshot.lastSample);
        }

        const mossScans = await fetchRecentMossScans(uid);
        if (alive) { setRecentMossScans(mossScans); setCarouselIdx(0); }
      } catch {
      }

      try {
        const tr = await supabase.from("forum_threads").select("id, user_id, title, body, created_at, forum_thread_categories(category_id, forum_categories(id, slug, label))").order("created_at", { ascending: false }).limit(50);
        if (!tr.error && (tr.data || []).length > 0) {
          const sel = tr.data[Math.floor(Math.random() * tr.data.length)];
          let profile = null;
          if (sel?.user_id) { const pr = await supabase.from(SUPABASE_PROFILES_TABLE).select("id, display_name, organization, avatar_url").eq("id", sel.user_id).maybeSingle(); profile = pr.data || null; }
          const md = sessionUser?.user_metadata || {};
          const authorName = profile?.display_name || (sel.user_id === sessionUser.id ? md.display_name || md.full_name || md.name || sessionUser.email?.split("@")[0] : null) || "Community member";
          const sessionAuthorAvatar = sel.user_id === sessionUser.id ? (pickAvatarUrl(sessionUser) || "") : "";
          const rawAuthorAvatar = profile?.avatar_url || sessionAuthorAvatar;
          const authorAvatar = rawAuthorAvatar ? ((await resolveAvatarUrl(rawAuthorAvatar)) || rawAuthorAvatar) : "";
          const cats = (sel.forum_thread_categories || []).map((i) => i.forum_categories).filter(Boolean);
          if (alive) {
            setSpotlightAvatarFailed(false);
            setForumSpotlight({ id: sel.id, title: sel.title, body: sel.body, created_at: sel.created_at, authorName, authorOrg: profile?.organization || "", authorAvatar, categories: cats });
          }
        } else if (alive) {
          setForumSpotlight(null);
          setSpotlightAvatarFailed(false);
        }
      } catch {
        if (alive) {
          setForumSpotlight(null);
          setSpotlightAvatarFailed(false);
        }
      }
    })();

    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.id]);

  /* ── Chat helpers ───────────────────────────────────────── */
  const handleSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    const next = [...chatHistory, { role: "user", text: msg }];
    setChatHistory(next); setChatInput(""); setChatLoading(true); setChatError("");
    try {
      const analysis = buildCopilotChatAnalysis({
        source: "web-dashboard",
        tab: chatTab,
        displayName,
        userStats,
        lastSample,
      });
      const p = await chatWithCopilot(analysis, next, msg);
      setChatHistory((prev) => [...prev, { role: "assistant", text: p.reply || "No response received." }]);
    } catch (e) { const t = e?.message || "Unable to contact chatbot right now."; setChatError(t); setChatHistory((prev) => [...prev, { role: "assistant", text: `Error: ${t}` }]); }
    finally { setChatLoading(false); }
  };

  /* ── Carousel auto-advance ────────────────────────── */
  useEffect(() => {
    if (recentMossScans.length <= 1 || carouselPaused) return;
    const id = setInterval(() => {
      setCarouselIdx((i) => (i + 1) % recentMossScans.length);
    }, 4000);
    return () => clearInterval(id);
  }, [recentMossScans.length, carouselPaused]);

  const openChatModal = () => { setChatOpen(true); setTimeout(() => setChatModalActive(true), 10); };
  const closeChatModal = () => { setChatModalActive(false); setTimeout(() => setChatOpen(false), 220); };
  const openTutorialModal = () => { setTutorialOpen(true); setTimeout(() => setTutorialModalActive(true), 10); };
  const closeTutorialModal = () => { setTutorialModalActive(false); setTimeout(() => setTutorialOpen(false), 220); };
  const handleOpenNotification = async (notification) => {
    if (!notification?.thread_id) return;

    try {
      if (!notification.is_read) {
        await markNotificationAsRead(notification.id);
      }
    } catch {
    } finally {
      setNotificationsVisible(false);
      navigate("/dashboard/community", {
        state: {
          openThreadId: notification.thread_id,
          notificationId: notification.id,
        },
      });
    }
  };
  const handleChatTabChange = (t) => { if (t === chatTab) return; setChatTab(t); setChatHistory([]); setChatInput(""); setChatError(""); };

  /* ── Last-sample contextual summary for chatbot card ───── */
  const buildSampleGreeting = () => {
    if (!lastSample) return null;
    const label = lastSample.sample_label ? `"${lastSample.sample_label}"` : "your last sample";
    const potable = lastSample.prediction_is_potable;
    const risk = lastSample.risk_level || (potable ? "low" : "high");
    const pct = lastSample.prediction_probability != null ? `${Math.round(lastSample.prediction_probability * 100)}%` : null;
    const ph = lastSample.ph != null ? lastSample.ph.toFixed(2) : null;
    const turb = lastSample.turbidity != null ? lastSample.turbidity.toFixed(2) : null;
    const date = lastSample.created_at ? new Date(lastSample.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

    const riskColor = risk.toLowerCase().includes("unsafe") || risk.toLowerCase().includes("high")
      ? "text-rose-600"
      : risk.toLowerCase().includes("watch") || risk.toLowerCase().includes("medium")
      ? "text-amber-600"
      : "text-emerald-600";

    return { label, potable, risk, pct, ph, turb, date, riskColor };
  };
  const sampleGreeting = buildSampleGreeting();

  const promptSuggestions = chatTab === CHAT_TABS.WATER
    ? ["Explain safe pH and turbidity ranges in simple terms.", "What filtration setup is best for microbial risk?", "How should I interpret watch vs unsafe risk levels?"]
    : ["Summarize my current scan and prediction activity.", "What should I do next based on my data trends?", "Give me a short action plan for this week."];

  /* ── Main render ────────────────────────────────────────── */
  return (
    <section className="flex-1 bg-gradient-to-br from-slate-50 via-white to-slate-100 px-6 py-6 lg:px-8">
      {/* Header */}
      <header>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-600">Welcome back, {displayName}!</p>
            <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">Water Quality Control Room</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button" onClick={openTutorialModal} className="inline-flex items-center gap-2 rounded-lg border border-sky-500 bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-700">
              <IconSpark className="h-3.5 w-3.5" />Tutorial
            </button>
            <button
              type="button"
              onClick={() => {
                setNotificationsVisible(true);
                refreshNotifications();
              }}
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-50"
              aria-label="Open notifications"
              title="Notifications"
            >
              <IconBell className="h-4 w-4" />
              {unreadNotificationsCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
                  {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
                </span>
              ) : null}
            </button>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                {avatarUrl && !avatarFailed ? (
                  <img
                    src={avatarUrl}
                    alt={`${displayName} profile picture`}
                    className="h-7 w-7 rounded-full border border-sky-200 object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      console.error('[avatar] image load failed:', avatarUrl, e?.nativeEvent || e);
                      setAvatarFailed(true);
                    }}
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-[10px] font-semibold text-sky-700">{buildInitials(displayName)}</span>
                )}
                <div className="leading-tight">
                  <p className="text-[9px] uppercase tracking-wider text-slate-400">Signed in</p>
                  <p className="text-xs font-semibold text-slate-700">{displayName}</p>
                </div>
              </div>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 shadow-sm">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white"><IconData className="h-3.5 w-3.5" /></span>
              <div className="leading-tight"><p className="text-[9px] uppercase tracking-wider text-emerald-700">Scans</p><p className="text-sm font-bold text-emerald-700">{userStats.scans}</p></div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 shadow-sm">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-sky-600 text-white"><IconWater className="h-3.5 w-3.5" /></span>
              <div className="leading-tight"><p className="text-[9px] uppercase tracking-wider text-sky-700">Predictions</p><p className="text-sm font-bold text-sky-700">{userStats.predictions}</p></div>
            </div>
          </div>
        </div>
      </header>

      {/* AI Chatbot Launcher */}
      <div className="mt-6 overflow-hidden rounded-2xl border-2 border-sky-200 bg-white shadow-md">
        {/* Card header bar */}
        <div className="flex items-center gap-3 border-b border-sky-100 bg-gradient-to-r from-sky-600 to-cyan-500 px-5 py-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white"><IconBot className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/80">AI Assistant</p>
            <p className="text-sm font-semibold text-white">AquaScope Copilot</p>
          </div>
          {sampleGreeting && (
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm ${sampleGreeting.potable ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
              {sampleGreeting.potable ? "Potable" : "Not Potable"}
            </span>
          )}
        </div>

        <div className="grid gap-0 lg:grid-cols-[160px_1fr]">
          {/* Robot animation */}
          <div className="flex items-center justify-center border-b border-sky-100 bg-sky-50/60 p-4 lg:border-b-0 lg:border-r lg:border-sky-100">
            <Lottie animationData={cuteRobotAnim} loop autoplay className="h-28 w-28" />
          </div>

          {/* Main content */}
          <div className="flex flex-col gap-4 p-5">
            {sampleGreeting ? (
              <>
                {/* Last reading header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Last Sample Reading</p>
                    <p className="mt-0.5 text-sm font-bold text-slate-800">{sampleGreeting.label}{sampleGreeting.date ? <span className="ml-2 text-xs font-normal text-slate-400">— {sampleGreeting.date}</span> : null}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-semibold capitalize shadow-sm ${
                    sampleGreeting.risk.toLowerCase().includes("unsafe") || sampleGreeting.risk.toLowerCase().includes("high")
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : sampleGreeting.risk.toLowerCase().includes("watch") || sampleGreeting.risk.toLowerCase().includes("medium")
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${
                      sampleGreeting.risk.toLowerCase().includes("unsafe") || sampleGreeting.risk.toLowerCase().includes("high")
                        ? "bg-rose-500"
                        : sampleGreeting.risk.toLowerCase().includes("watch") || sampleGreeting.risk.toLowerCase().includes("medium")
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`} />
                    {sampleGreeting.risk} risk
                  </span>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {sampleGreeting.pct && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Confidence</p>
                      <p className="mt-1 text-lg font-bold text-slate-800">{sampleGreeting.pct}</p>
                    </div>
                  )}
                  {sampleGreeting.ph && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-500">pH Level</p>
                      <p className="mt-1 text-lg font-bold text-sky-700">{sampleGreeting.ph}</p>
                      <p className="text-[10px] text-slate-400">Target: 6.5–8.5</p>
                    </div>
                  )}
                  {sampleGreeting.turb && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-500">Turbidity</p>
                      <p className="mt-1 text-lg font-bold text-violet-700">{sampleGreeting.turb}</p>
                      <p className="text-[10px] text-slate-400">NTU</p>
                    </div>
                  )}
                  <div className={`rounded-xl border px-3 py-2.5 ${sampleGreeting.potable ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider ${sampleGreeting.potable ? "text-emerald-500" : "text-rose-500"}`}>Status</p>
                    <p className={`mt-1 text-sm font-bold ${sampleGreeting.potable ? "text-emerald-700" : "text-rose-700"}`}>{sampleGreeting.potable ? "✓ Safe" : "✗ Unsafe"}</p>
                    <p className="text-[10px] text-slate-400">for drinking</p>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm font-semibold text-slate-700">Your AI water analysis assistant</p>
                <p className="mt-1 text-xs text-slate-500">Ask questions, interpret results, and get next-step guidance — personalized to your workflow.</p>
              </div>
            )}

            {/* Chat button */}
            <button
              type="button"
              className="group flex w-full items-center gap-3 rounded-xl border-2 border-sky-200 bg-sky-50 px-4 py-3 text-left transition hover:border-sky-400 hover:bg-sky-100"
              onClick={openChatModal}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm"><IconBot className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-sky-700">
                  {sampleGreeting ? "Ask about your last reading" : "Start a conversation"}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {sampleGreeting
                    ? `${sampleGreeting.potable ? "Potable" : "Not potable"} · ${sampleGreeting.risk} risk${sampleGreeting.ph ? ` · pH ${sampleGreeting.ph}` : ""} — tap to discuss`
                    : "How can I help you today?"}
                </p>
              </div>
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm transition group-hover:bg-sky-700"><IconSend className="h-3.5 w-3.5" /></span>
            </button>
          </div>
        </div>
      </div>

      {/* Chat modal */}
      {chatOpen && (
        <div className={`fixed inset-0 z-50 flex h-[100dvh] items-end justify-center overflow-y-auto bg-slate-900/50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-opacity duration-200 sm:items-center ${chatModalActive ? "opacity-100" : "opacity-0"}`} onClick={closeChatModal}>
          <div className={`my-auto w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl border-2 border-sky-400 bg-gradient-to-b from-white to-sky-50/40 p-5 shadow-2xl ring-1 ring-sky-300 transition-all duration-200 ${chatModalActive ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl border-2 border-sky-300 bg-sky-100 p-1"><Lottie animationData={aiAnim} loop autoplay className="h-full w-full" /></div>
                <div>
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><IconBot className="h-4 w-4" />AquaScope Copilot</p>
                  <p className="text-xs text-slate-500">
                    {sampleGreeting
                      ? `Hi ${displayName}! I can see your last reading. How can I help you today?`
                      : `Hi ${displayName}! How can I help you today?`}
                  </p>
                </div>
              </div>
              <button type="button" className="inline-flex items-center gap-1 rounded-full border-2 border-slate-400 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100" onClick={closeChatModal}><IconClose className="h-3.5 w-3.5" />Close</button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button type="button" className={`inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-left text-sm font-medium transition ${chatTab === CHAT_TABS.WATER ? "border-sky-400 bg-sky-100 text-sky-700" : "border-slate-300 bg-white text-slate-600 hover:bg-sky-50 hover:border-sky-300"}`} onClick={() => handleChatTabChange(CHAT_TABS.WATER)}><IconWater className="h-4 w-4" />Ask about water quality</button>
              <button type="button" className={`inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-left text-sm font-medium transition ${chatTab === CHAT_TABS.DATA ? "border-sky-400 bg-sky-100 text-sky-700" : "border-slate-300 bg-white text-slate-600 hover:bg-sky-50 hover:border-sky-300"}`} onClick={() => handleChatTabChange(CHAT_TABS.DATA)}><IconData className="h-4 w-4" />Ask about my data</button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {promptSuggestions.map((s) => (<button key={s} type="button" className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 transition hover:bg-sky-100 hover:border-sky-400" onClick={() => setChatInput(s)}>{s}</button>))}
            </div>

            <div className="mt-4 h-[min(20rem,38dvh)] space-y-2 overflow-y-auto rounded-2xl border-2 border-sky-300 bg-sky-50/60 p-4">
              {chatHistory.length === 0 ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700"><IconBot className="h-3.5 w-3.5" /></span>
                    <div className="rounded-2xl rounded-tl-none border-2 border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-700 shadow-sm space-y-1.5">
                      <p className="font-medium">How can I help you today?</p>
                      {sampleGreeting ? (
                        <p className="text-xs text-slate-500 leading-relaxed">
                          I can see {sampleGreeting.label}{sampleGreeting.date ? ` from ${sampleGreeting.date}` : ""}.
                          It was marked as{" "}
                          <span className={`font-semibold ${sampleGreeting.potable ? "text-emerald-600" : "text-rose-600"}`}>
                            {sampleGreeting.potable ? "potable" : "not potable"}
                          </span>
                          {sampleGreeting.pct && <> ({sampleGreeting.pct} confidence)</>}
                          {" "}with a <span className={`font-semibold capitalize ${sampleGreeting.riskColor}`}>{sampleGreeting.risk}</span> risk level
                          {sampleGreeting.ph && <>, pH {sampleGreeting.ph}</>}
                          {sampleGreeting.turb && <>, turbidity {sampleGreeting.turb} NTU</>}.
                          {" "}Want me to break down what these numbers mean, or suggest next steps?
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">{chatTab === CHAT_TABS.WATER ? "Ask about risk levels, threshold meaning, filtration options, and interpretation of water parameters." : "Ask for summaries and recommendations based on your dashboard activity and prediction history."}</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : chatHistory.map((m, i) => (
                <div key={`${m.role}-${i}`} className={`max-w-[85%] rounded-2xl border-2 px-4 py-3 text-sm shadow-sm ${m.role === "user" ? "ml-auto border-sky-400 bg-sky-100 text-slate-800" : "border-sky-200 bg-sky-50 text-slate-700"}`}>
                  <div className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">{m.role === "user" ? <IconData className="h-3 w-3" /> : <IconBot className="h-3 w-3" />}{m.role === "user" ? "You" : "Copilot"}</div>
                  <p className="whitespace-pre-line">{m.role === "assistant" ? formatCopilotText(m.text) : m.text}</p>
                </div>
              ))}
              {chatLoading && (
                <div className="max-w-[85%] rounded-2xl border-2 border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-700 shadow-sm">
                  <div className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-500"><IconBot className="h-3 w-3" />Copilot</div>
                  <div className="inline-flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 animate-bounce rounded-full bg-sky-400" /><span className="h-2 w-2 animate-bounce rounded-full bg-sky-400 [animation-delay:120ms]" /><span className="h-2 w-2 animate-bounce rounded-full bg-sky-400 [animation-delay:240ms]" /><span className="ml-1 text-xs">Thinking...</span></div>
                </div>
              )}
            </div>

            {chatError && <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">{chatError}</p>}

            <div className="mt-4 flex items-end gap-3">
              <textarea className="min-h-[88px] flex-1 resize-none rounded-2xl border-2 border-sky-300 bg-white px-4 py-3 text-sm text-slate-800 outline-none ring-sky-400 focus:ring focus:border-sky-500" placeholder={chatTab === CHAT_TABS.WATER ? "Ask about filtration methods, risk interpretation, or safe water actions..." : "Ask about your trends, usage summary, and recommended next steps..."} value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
              <button type="button" className={`inline-flex min-w-[116px] items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition ${chatLoading || !chatInput.trim() ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-sky-600 text-white hover:bg-sky-700"}`} onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()}>
                {chatLoading ? (<><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>Sending...</>) : (<><IconSend className="h-4 w-4" />Send message</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tutorial modal */}
      {tutorialOpen && (
        <div className={`fixed inset-0 z-50 flex h-[100dvh] items-end justify-center overflow-y-auto bg-slate-900/60 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-opacity duration-200 sm:items-center ${tutorialModalActive ? "opacity-100" : "opacity-0"}`} onClick={closeTutorialModal}>
          <div className={`my-auto w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 via-cyan-500 to-sky-600 p-[3px] shadow-2xl shadow-sky-500/40 transition-all duration-200 ${tutorialModalActive ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`} onClick={(e) => e.stopPropagation()}>
            <div className="h-full max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[calc(1.5rem-3px)] bg-white p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-600 to-cyan-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-white shadow-sm"><IconSpark className="h-3.5 w-3.5" />Quick tutorial</p>
                  <h2 className="mt-3 text-2xl font-bold text-slate-900">How to scan correctly</h2>
                  <p className="mt-2 text-base leading-relaxed text-slate-600">Follow these steps to get accurate results every time.</p>
                </div>
                <button type="button" className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-slate-400 hover:bg-slate-50" onClick={closeTutorialModal}><IconClose className="h-3.5 w-3.5" />Close</button>
              </div>

              <div className="mt-8 space-y-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-600 to-cyan-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white"><IconPhone className="h-3.5 w-3.5" />Before you start</div>
                  <p className="text-[15px] leading-relaxed text-slate-700">Download the mobile app first to start field scanning and capture workflows.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-500 text-base font-bold text-white shadow-sm">1</span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">Prepare OCR input</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">Download the template first, complete it clearly, then scan the form. This gives cleaner field detection and fewer extraction errors.</p>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700"><IconDownload className="h-3.5 w-3.5" />Download template before OCR</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-500 text-base font-bold text-white shadow-sm">2</span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">Run moss detection</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">Use <em>Capture Container</em> and take a full, clear shot of the water container so the model can detect moss presence reliably.</p>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700"><IconCamera className="h-3.5 w-3.5" />Use Capture Container mode</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-500 text-base font-bold text-white shadow-sm">3</span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">Capture quality check</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">Scan in good lighting <IconSun className="inline h-4 w-4 text-amber-500" />, keep the camera steady, avoid shadows/blur, and keep the full form or container inside frame.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-500 text-base font-bold text-white shadow-sm">4</span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">Review and track</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">Open scan results immediately after capture, then use <strong>Prediction History</strong> and <strong>Analytics</strong> to monitor trends and revisit past records.</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => { closeTutorialModal(); navigate("/dashboard/scans"); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"><IconData className="h-3.5 w-3.5" />Open scan results</button>
                        <button type="button" onClick={() => { closeTutorialModal(); navigate("/dashboard/analytics"); }} className="inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-xs font-medium text-sky-700 transition hover:bg-gradient-to-r hover:from-sky-600 hover:to-cyan-600 hover:text-white hover:shadow-sm"><IconClock className="h-3.5 w-3.5" />Prediction history / analytics</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Container Scan Carousel */}
      {recentMossScans.length > 0 && (
        <div className="mt-6">
          <article
            className="overflow-hidden rounded-2xl border-2 border-emerald-200 bg-white shadow-md"
            onMouseEnter={() => setCarouselPaused(true)}
            onMouseLeave={() => setCarouselPaused(false)}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white">
                  <IconCamera className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-white/80">Container Scans</p>
                  <p className="text-sm font-semibold text-white">Recent Moss Detections</p>
                </div>
              </div>
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                {carouselIdx + 1} / {recentMossScans.length}
              </span>
            </div>

            {/* Auto-advance progress bar */}
            {recentMossScans.length > 1 && (
              <div className="h-0.5 w-full bg-emerald-100">
                <div
                  key={`${carouselIdx}-${carouselPaused}`}
                  className="h-full bg-emerald-400"
                  style={carouselPaused ? { width: "0%" } : { animation: "carousel-progress 4s linear forwards" }}
                />
              </div>
            )}

            {/* Carousel body */}
            <div className="relative">
              {(() => {
                const scan = recentMossScans[carouselIdx];
                const meta = MOSS_META[scan.predicted_class] || MOSS_META.LightMoss;
                const pct = scan.confidence != null ? `${Math.round(scan.confidence * 100)}%` : null;
                const dateStr = scan.created_at
                  ? new Date(scan.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                  : null;
                return (
                  <div className="flex flex-col sm:flex-row">
                    {/* Image pane */}
                    <div className="relative flex items-center justify-center bg-slate-900 sm:w-72 sm:shrink-0">
                      {scan.image_uri ? (
                        <img
                          key={scan.id}
                          src={scan.image_uri}
                          alt={`${meta.label} container scan`}
                          className="h-56 w-full object-cover sm:h-full"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-56 w-full items-center justify-center text-slate-500 sm:h-full">
                          <IconCamera className="h-10 w-10 opacity-30" />
                        </div>
                      )}
                      {/* Class badge overlay */}
                      <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm ${meta.bg} ${meta.border} ${meta.text}`}>
                        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </div>

                    {/* Info pane */}
                    <div className="flex flex-1 flex-col justify-between gap-4 p-5">
                      <div className="space-y-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Detection</p>
                          <p className="mt-1 text-xl font-bold text-slate-900">{meta.label}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {pct && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Confidence</p>
                              <p className="mt-1 text-lg font-bold text-slate-800">{pct}</p>
                            </div>
                          )}
                          {dateStr && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Scanned</p>
                              <p className="mt-1 text-sm font-bold text-slate-800">{dateStr}</p>
                            </div>
                          )}
                        </div>
                        <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${meta.bg} ${meta.border} ${meta.text}`}>
                          {scan.predicted_class === "HeavyMoss" && "Heavy moss detected — immediate cleaning and decontamination is strongly recommended."}
                          {scan.predicted_class === "MediumMoss" && "Moderate moss growth present — schedule cleaning soon to prevent further contamination."}
                          {scan.predicted_class === "LightMoss" && "Early-stage moss detected — routine cleaning advised to prevent escalation."}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => navigate("/dashboard/scans")}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                      >
                        <IconData className="h-3.5 w-3.5" />
                        View all scan results
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Prev / Next */}
              {recentMossScans.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous scan"
                    onClick={() => setCarouselIdx((i) => (i - 1 + recentMossScans.length) % recentMossScans.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:bg-emerald-600 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m15 18-6-6 6-6" /></svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Next scan"
                    onClick={() => setCarouselIdx((i) => (i + 1) % recentMossScans.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:bg-emerald-600 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m9 18 6-6-6-6" /></svg>
                  </button>
                </>
              )}
            </div>

            {/* Dot indicators */}
            {recentMossScans.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-3">
                {recentMossScans.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Go to scan ${i + 1}`}
                    onClick={() => setCarouselIdx(i)}
                    className={`h-2 rounded-full transition-all duration-200 ${
                      i === carouselIdx ? "w-5 bg-emerald-500" : "w-2 bg-slate-300 hover:bg-emerald-300"
                    }`}
                  />
                ))}
              </div>
            )}
          </article>
        </div>
      )}

      {/* Community spotlight */}
      <div className="mt-6">
        <article className="overflow-hidden rounded-xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-5 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12"><Lottie animationData={forumAnim} loop autoplay className="h-full w-full" /></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Community spotlight</p><p className="text-xs text-slate-600">Discover discussions from the forum</p></div>
            </div>
            <button type="button" onClick={() => navigate("/dashboard/community")} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"><IconUsers className="h-3.5 w-3.5" />View forum</button>
          </div>
          {forumSpotlight ? (
            <div className="mt-4 rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-violet-200 bg-violet-100 text-xs font-semibold text-violet-700">
                    {forumSpotlight.authorAvatar && !spotlightAvatarFailed ? (
                      <img
                        src={forumSpotlight.authorAvatar}
                        alt={`${forumSpotlight.authorName} profile picture`}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={() => setSpotlightAvatarFailed(true)}
                      />
                    ) : (
                      buildInitials(forumSpotlight.authorName)
                    )}
                  </div>
                  <div><p className="text-sm font-semibold text-slate-900">{forumSpotlight.authorName}</p><p className="text-xs text-slate-500">{forumSpotlight.authorOrg || "Community"}</p></div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500"><IconClock className="h-3 w-3" />{formatRelativeTime(forumSpotlight.created_at)}</span>
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-900">{forumSpotlight.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{forumSpotlight.body?.length > 200 ? `${forumSpotlight.body.slice(0, 200)}...` : forumSpotlight.body}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{(forumSpotlight.categories || []).slice(0, 3).map((tag) => (<span key={tag.id} className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">#{tag.label}</span>))}</div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                <p className="text-xs text-slate-500">Join the conversation</p>
                <button type="button" onClick={() => navigate("/dashboard/community")} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700"><IconSend className="h-3 w-3" />Join</button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 px-4 py-6 text-center text-xs text-slate-600">No community thread available yet.</div>
          )}
        </article>
      </div>

      {/* ML Pipeline */}
      <div className="mt-6">
        <article className="rounded-xl border-2 border-sky-300 bg-white shadow-md">
          <button
            type="button"
            onClick={() => setPipelineOpen((v) => !v)}
            aria-expanded={pipelineOpen}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700">
                <IconData className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-600">ML Pipeline</p>
                <p className="text-xs text-slate-500">End-to-end processing stages</p>
              </div>
            </div>
            <IconChevron className={`h-5 w-5 text-slate-400 transition-transform duration-200 ${pipelineOpen ? "rotate-180" : ""}`} />
          </button>
          {pipelineOpen && (
            <div className="border-t border-slate-100 px-5 pb-5 pt-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {pipelineSteps.map((s, i) => (
                  <div key={s.stage} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-sky-300 hover:bg-sky-50">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-600 text-xs font-bold text-white">{i + 1}</span>
                    <div><p className="text-sm font-semibold text-slate-900">{s.stage}</p><p className="mt-0.5 text-xs text-slate-500">{s.detail}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>

      <ForumNotificationsModal
        visible={notificationsVisible}
        onClose={() => setNotificationsVisible(false)}
        notifications={notifications}
        notificationsLoading={notificationsLoading}
        notificationsError={notificationsError}
        notificationsBusyId={notificationsBusyId}
        onOpenNotification={handleOpenNotification}
      />
    </section>
  );
}
