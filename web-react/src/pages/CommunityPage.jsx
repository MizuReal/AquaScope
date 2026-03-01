import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";
import { Filter } from "bad-words";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import ForumNotificationsModal from "@/components/forum/ForumNotificationsModal";
import { useForumNotifications } from "@/hooks/useForumNotifications";
import forumAnim from "@/assets/lottie/forumanim.json";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";
const MAX_CATEGORIES = 5;
const THREADS_BATCH_SIZE = 10;
const THREAD_MODAL_ANIMATION_MS = 220;

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

const buildInitials = (value) => {
  if (!value) return "NA";
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NA";
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  return `${first}${last}`.toUpperCase();
};

const formatRelativeTime = (value) => {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const iconProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

const IconRefresh = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

const IconPlus = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const IconOpen = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M14 3h7v7h-2V6.41l-8.29 8.3-1.42-1.42 8.3-8.29H14V3Z" />
    <path d="M5 5h6v2H7v10h10v-4h2v6H5V5Z" />
  </svg>
);

const IconHeart = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);

const IconHeartFilled = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 21s-8-5-8-11a5 5 0 0 1 8-3.9A5 5 0 0 1 20 10c0 6-8 11-8 11Z" />
  </svg>
);

const IconReply = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="m9 17-5-5 5-5" />
    <path d="M20 18a7 7 0 0 0-7-7H4" />
  </svg>
);

const IconClose = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </svg>
);

const IconUsers = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M14.5 19a4.5 4.5 0 0 1 6 0" />
  </svg>
);

const IconTag = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="m20.6 13.4-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
    <circle cx="7.5" cy="7.5" r="1" />
  </svg>
);

const IconChevron = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconGlobe = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  </svg>
);

const IconPencil = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="m12 20 8-8-4-4-8 8-1 5 5-1Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const IconDocument = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h4" />
  </svg>
);

const IconDroplet = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10z" />
  </svg>
);

const IconAlert = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 9v5" />
    <path d="M12 17h.01" />
  </svg>
);

const IconShield = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 3 5 6v6c0 5 3.4 8 7 9 3.6-1 7-4 7-9V6l-7-3Z" />
  </svg>
);

const IconFlask = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M10 3v4l-4.5 7.5A3 3 0 0 0 8.1 19h7.8a3 3 0 0 0 2.6-4.5L14 7V3" />
    <path d="M9 13h6" />
  </svg>
);

const IconSettings = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.1 1.1a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0l-1.1-1.1a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1 1 0 0 1-1-1v-1.6a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4L5.9 4a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V3a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v1.6a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6Z" />
  </svg>
);

const IconSearch = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const IconMegaphone = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M3 11v2a2 2 0 0 0 2 2h2l8 4V5l-8 4H5a2 2 0 0 0-2 2Z" />
    <path d="M18 9a4 4 0 0 1 0 6" />
  </svg>
);

const IconBell = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M15 18H5a2 2 0 0 1-2-2v-1.3c0-.7.2-1.4.6-2l1-1.4A4.8 4.8 0 0 0 5.5 8V7a4.5 4.5 0 1 1 9 0v1a4.8 4.8 0 0 0 .9 2.9l1 1.4c.4.6.6 1.3.6 2V16a2 2 0 0 1-2 2h0Z" />
    <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
  </svg>
);

const IconSpark = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" />
  </svg>
);

function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", options = {}) => {
    const id = ++idRef.current;
    const toast = {
      id,
      message,
      type,
      actionLabel: options.actionLabel || "",
      onAction: typeof options.onAction === "function" ? options.onAction : null,
    };

    setToasts((prev) => [...prev, toast]);

    const duration = Number(options.duration ?? 4200);
    if (duration > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const runToastAction = useCallback((toast) => {
    try {
      toast?.onAction?.();
    } finally {
      if (toast?.id) {
        dismissToast(toast.id);
      }
    }
  }, [dismissToast]);

  return { toasts, addToast, dismissToast, runToastAction };
}

function ToastContainer({ toasts, onDismiss, onAction }) {
  if (!toasts.length) return null;

  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex w-[min(92vw,420px)] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-2xl border px-4 py-3 shadow-lg ${toneClass[toast.type] || toneClass.info}`}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center">
              <IconAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-5">{toast.message}</p>
              {toast.actionLabel ? (
                <button
                  type="button"
                  onClick={() => onAction(toast)}
                  className="mt-2 rounded-full border border-current/30 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] transition hover:bg-white"
                >
                  {toast.actionLabel}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded-full p-1 transition hover:bg-black/5"
              aria-label="Dismiss notification"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const TOPIC_ICON_KEYS = {
  water: "water",
  analysis: "analysis",
  bacteria: "risk",
  microbial: "risk",
  chemical: "chemical",
  chemicals: "chemical",
  treatment: "settings",
  alert: "alert",
  alerts: "alert",
  safety: "shield",
  ph: "chemical",
  contamination: "alert",
  regulations: "document",
  policy: "document",
  tech: "settings",
  technology: "settings",
  news: "news",
  research: "search",
  help: "search",
  discussion: "community",
  announcement: "news",
  announcements: "news",
  report: "document",
  reports: "document",
  tips: "tips",
  community: "community",
  general: "community",
};

const resolveTopicIconKey = (slug, label) => {
  const raw = String(slug || label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const direct = TOPIC_ICON_KEYS[String(slug || "").toLowerCase()];
  if (direct) return direct;
  const key = Object.keys(TOPIC_ICON_KEYS).find((k) => {
    const normalized = k.replace(/[^a-z0-9]/g, "");
    return raw.includes(normalized) || normalized.includes(raw);
  });
  return key ? TOPIC_ICON_KEYS[key] : "tag";
};

const renderTopicIcon = (iconKey, className) => {
  if (iconKey === "water") return <IconDroplet className={className} />;
  if (iconKey === "risk" || iconKey === "alert") return <IconAlert className={className} />;
  if (iconKey === "shield") return <IconShield className={className} />;
  if (iconKey === "chemical") return <IconFlask className={className} />;
  if (iconKey === "settings") return <IconSettings className={className} />;
  if (iconKey === "document") return <IconDocument className={className} />;
  if (iconKey === "news") return <IconMegaphone className={className} />;
  if (iconKey === "search") return <IconSearch className={className} />;
  if (iconKey === "tips") return <IconSpark className={className} />;
  if (iconKey === "community") return <IconUsers className={className} />;
  return <IconTag className={className} />;
};

const makeProfileMap = (profiles = []) => {
  return new Map(profiles.map((profile) => [profile.id, profile]));
};

const dedupeById = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item?.id) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const profileToAuthor = (profile, fallbackName = "Community member") => {
  return {
    authorName: profile?.display_name || fallbackName,
    authorOrg: profile?.organization || "",
    authorAvatar: profile?.avatar_url || "",
  };
};

const sessionUserToAuthor = (user, fallbackName = "Community member", resolvedAvatar = "") => {
  const metadata = user?.user_metadata || {};
  return {
    authorName:
      metadata.display_name ||
      metadata.full_name ||
      metadata.name ||
      user?.email?.split("@")[0] ||
      fallbackName,
    authorOrg: metadata.organization || "",
    authorAvatar: resolvedAvatar || metadata.avatar_url || metadata.picture || "",
  };
};

const buildProfilePayloadFromUser = (user) => {
  const metadata = user?.user_metadata || {};
  const payload = {
    id: user?.id,
  };

  const displayName =
    metadata.display_name ||
    metadata.full_name ||
    metadata.name ||
    user?.email?.split("@")[0] ||
    "";
  if (displayName) {
    payload.display_name = displayName;
  }

  if (metadata.organization) {
    payload.organization = metadata.organization;
  }

  const avatar = metadata.avatar_url || metadata.picture || "";
  if (avatar) {
    payload.avatar_url = avatar;
  }

  return payload;
};

const resolveAuthor = ({
  profile,
  userId,
  sessionUser,
  sessionAvatar,
  fallbackName = "Community member",
}) => {
  if (profile) {
    return profileToAuthor(profile, fallbackName);
  }
  if (sessionUser?.id && userId === sessionUser.id) {
    return sessionUserToAuthor(sessionUser, fallbackName, sessionAvatar);
  }
  return profileToAuthor(null, fallbackName);
};

function Avatar({ src, name }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "Avatar"}
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="text-xs font-semibold leading-none text-slate-700">{buildInitials(name)}</span>
    </div>
  );
}

function StatPill({ label, value, tone = "neutral", icon, onClick, title, active = false, disabled = false }) {
  const toneClass =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-slate-200 bg-slate-100 text-slate-700";

  const activeClass = active ? "ring-2 ring-rose-200" : "";

  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      title={title}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${toneClass} ${activeClass} ${onClick ? "transition hover:brightness-95" : ""} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      {icon ? <span className="text-current">{icon}</span> : null}
      <span className="font-medium">{label}</span>
      <span className="font-semibold">{value}</span>
    </Comp>
  );
}

function ThreadCard({
  thread,
  stats,
  onOpenThread,
  onToggleThreadLike,
  threadLikeBusyId,
  canDelete,
  onDeleteThread,
  deleteBusyId,
}) {
  return (
    <article className="rounded-3xl border-2 border-sky-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <Avatar src={thread.authorAvatar} name={thread.authorName} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{thread.authorName}</p>
            <p className="text-xs text-slate-500">{thread.authorOrg || "Community"}</p>
          </div>
        </div>
        <span className="text-xs text-slate-500">{formatRelativeTime(thread.created_at)}</span>
      </div>

      <h3 className="mt-4 text-lg font-semibold text-slate-900">{thread.title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {thread.body?.length > 220 ? `${thread.body.slice(0, 220)}...` : thread.body}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(thread.categories || []).map((tag) => (
          <span
            key={tag.id}
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700"
          >
            #{tag.label}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatPill
            label="Likes"
            value={stats?.likes || 0}
            tone="rose"
            icon={stats?.userLiked ? <IconHeartFilled className="h-3.5 w-3.5" /> : <IconHeart className="h-3.5 w-3.5" />}
            onClick={onToggleThreadLike}
            title="Like this thread"
            active={!!stats?.userLiked}
            disabled={threadLikeBusyId === thread.id}
          />
          <StatPill
            label="Replies"
            value={stats?.replies || 0}
            tone="sky"
            icon={<IconReply className="h-3.5 w-3.5" />}
            onClick={onOpenThread}
            title="Open thread replies"
          />
        </div>
        <div className="flex items-center gap-3">
          {canDelete ? (
            <button
              type="button"
              onClick={onDeleteThread}
              disabled={deleteBusyId === thread.id}
              className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500 transition hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteBusyId === thread.id ? "Deleting..." : "Delete"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenThread}
            className="inline-flex items-center gap-2 rounded-full border border-sky-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-sky-100 text-sky-700">
              <IconOpen className="h-3.5 w-3.5" />
            </span>
            Open thread
          </button>
        </div>
      </div>
    </article>
  );
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const { user: sessionUser } = useAuth();
  const [sessionAvatarUrl, setSessionAvatarUrl] = useState("");

  // Refs so fetchThreadsBatch can access the latest values without its
  // useCallback identity changing on every avatar/user update.
  const sessionUserRef = useRef(sessionUser);
  const sessionAvatarUrlRef = useRef(sessionAvatarUrl);
  useEffect(() => { sessionUserRef.current = sessionUser; }, [sessionUser]);
  useEffect(() => { sessionAvatarUrlRef.current = sessionAvatarUrl; }, [sessionAvatarUrl]);

  const [categories, setCategories] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadStats, setThreadStats] = useState({});
  const [selectedTag, setSelectedTag] = useState("all");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [feedError, setFeedError] = useState("");

  const [threadModalVisible, setThreadModalVisible] = useState(false);
  const [threadModalActive, setThreadModalActive] = useState(false);
  const [activeThread, setActiveThread] = useState(null);
  const [threadPosts, setThreadPosts] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);

  const [composeVisible, setComposeVisible] = useState(false);
  const [composeModalActive, setComposeModalActive] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeCategories, setComposeCategories] = useState([]);
  const [composeError, setComposeError] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [likeBusyId, setLikeBusyId] = useState("");
  const [threadLikeBusyId, setThreadLikeBusyId] = useState("");
  const [threadDeleteBusyId, setThreadDeleteBusyId] = useState("");
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [loadingAnimData, setLoadingAnimData] = useState(null);
  const loadMoreTriggerRef = useRef(null);
  const badWordFilter = useMemo(() => new Filter(), []);
  const { toasts, addToast, dismissToast, runToastAction } = useToast();
  const {
    notifications,
    notificationsLoading,
    notificationsError,
    notificationsBusyId,
    unreadNotificationsCount,
    refreshNotifications,
    markNotificationAsRead,
    setNotificationsError,
  } = useForumNotifications({
    sessionUserId: sessionUser?.id || "",
    profilesTable: SUPABASE_PROFILES_TABLE,
    normalizeAvatarUrl: resolveAvatarUrl,
  });
  const pendingOpenThreadId = location.state?.openThreadId || "";
  const pendingNotificationId = location.state?.notificationId || "";

  useEffect(() => {
    let mounted = true;
    const loadAnimation = async () => {
      try {
        const response = await fetch("/loading.json");
        if (!response.ok) return;
        const payload = await response.json();
        if (mounted) {
          setLoadingAnimData(payload);
        }
      } catch {
      }
    };
    loadAnimation();
    return () => {
      mounted = false;
    };
  }, []);

  const openCompose = () => {
    setComposeVisible(true);
    window.setTimeout(() => setComposeModalActive(true), 10);
  };

  const closeCompose = () => {
    setComposeModalActive(false);
    window.setTimeout(() => {
      setComposeVisible(false);
    }, THREAD_MODAL_ANIMATION_MS);
  };

  const containsBadWords = useCallback((text) => {
    if (!text) return false;
    try {
      return badWordFilter.isProfane(text);
    } catch {
      return false;
    }
  }, [badWordFilter]);

  const syncSessionProfile = useCallback(async (user) => {
    if (!user?.id) return;

    const payload = buildProfilePayloadFromUser(user);
    if (!payload.id) return;

    const { error } = await supabase
      .from(SUPABASE_PROFILES_TABLE)
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.warn("[Supabase] profile sync failed:", error?.message || error);
    }
  }, []);

  // Sync the user's profile to Supabase whenever the session user changes.
  useEffect(() => {
    if (!sessionUser?.id) return;
    syncSessionProfile(sessionUser);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.id, syncSessionProfile]);

  useEffect(() => {
    if (!sessionUser?.id) {
      setSessionAvatarUrl("");
      return;
    }

    let active = true;

    const refreshSessionAvatar = async () => {
      const metadataAvatar = sessionUser?.user_metadata?.avatar_url || sessionUser?.user_metadata?.picture || "";
      const resolvedMeta = await resolveAvatarUrl(metadataAvatar);
      if (active) {
        setSessionAvatarUrl(resolvedMeta || metadataAvatar || "");
      }

      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("avatar_url")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (profileResult.error || !active) return;

      if (profileResult.data?.avatar_url) {
        const resolvedProfile = await resolveAvatarUrl(profileResult.data.avatar_url);
        if (active) {
          setSessionAvatarUrl(resolvedProfile || profileResult.data.avatar_url);
        }
      }
    };

    refreshSessionAvatar();

    return () => {
      active = false;
    };
  }, [sessionUser]);

  const fetchThreadsBatch = useCallback(async (offset, limit) => {
    const toIndex = offset + limit - 1;
    const threadResult = await supabase
      .from("forum_threads")
      .select(
        "id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))",
      )
      .order("created_at", { ascending: false })
      .range(offset, toIndex);

    if (threadResult.error) throw threadResult.error;

    const rawThreads = threadResult.data || [];
    const userIds = Array.from(new Set(rawThreads.map((thread) => thread.user_id).filter(Boolean)));

    const profilesResult = userIds.length
      ? await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("id, display_name, organization, avatar_url")
          .in("id", userIds)
      : { data: [] };

    if (profilesResult.error) throw profilesResult.error;

    const resolvedProfiles = await Promise.all(
      (profilesResult.data || []).map(async (profile) => {
        if (!profile?.avatar_url) return profile;
        const resolved = await resolveAvatarUrl(profile.avatar_url);
        return {
          ...profile,
          avatar_url: resolved || profile.avatar_url,
        };
      }),
    );

    const profileMap = makeProfileMap(resolvedProfiles);

    const hydratedThreads = rawThreads.map((thread) => {
      const categoryLinks = thread.forum_thread_categories || [];
      const mappedCategories = categoryLinks.map((link) => link.forum_categories).filter(Boolean);
      return {
        ...thread,
        categories: mappedCategories,
        ...resolveAuthor({
          profile: profileMap.get(thread.user_id),
          userId: thread.user_id,
          sessionUser: sessionUserRef.current,
          sessionAvatar: sessionAvatarUrlRef.current,
        }),
      };
    });

    const threadIds = hydratedThreads.map((thread) => thread.id);
    let postsData = [];
    if (threadIds.length) {
      const postsResult = await supabase.from("forum_posts").select("id, thread_id").in("thread_id", threadIds);
      if (postsResult.error) throw postsResult.error;
      postsData = postsResult.data || [];
    }

    const repliesCount = postsData.reduce((acc, post) => {
      acc[post.thread_id] = (acc[post.thread_id] || 0) + 1;
      return acc;
    }, {});

    const likesCount = {};
    const likedThreadIds = new Set();
    if (threadIds.length) {
      const likesResult = await supabase
        .from("forum_thread_likes")
        .select("thread_id, user_id")
        .in("thread_id", threadIds);

      if (likesResult.error) throw likesResult.error;

      (likesResult.data || []).forEach((row) => {
        const threadId = row.thread_id;
        if (!threadId) return;
        likesCount[threadId] = (likesCount[threadId] || 0) + 1;
        const su = sessionUserRef.current;
        if (su?.id && row.user_id === su.id) {
          likedThreadIds.add(threadId);
        }
      });
    }

    const stats = hydratedThreads.reduce((acc, thread) => {
      acc[thread.id] = {
        replies: repliesCount[thread.id] || 0,
        likes: likesCount[thread.id] || 0,
        userLiked: likedThreadIds.has(thread.id),
      };
      return acc;
    }, {});

    return { hydratedThreads, stats };
  // fetchThreadsBatch is now stable — it reads session values through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadForumData = useCallback(async () => {
    setLoading(true);
    setFeedError("");

    try {
      const categoryResult = await supabase
        .from("forum_categories")
        .select("id, slug, label, is_active")
        .eq("is_active", true)
        .order("label", { ascending: true });

      if (categoryResult.error) throw categoryResult.error;
      const activeCategories = categoryResult.data || [];
      const { hydratedThreads, stats } = await fetchThreadsBatch(0, THREADS_BATCH_SIZE);

      setCategories(activeCategories);
      setThreads(hydratedThreads);
      setThreadStats(stats);
      setHasMoreThreads(hydratedThreads.length === THREADS_BATCH_SIZE);
    } catch (error) {
      console.warn("[Supabase] forum load failed:", error?.message || error);
      setFeedError("Unable to load forum right now.");
    } finally {
      setLoading(false);
    }
  }, [fetchThreadsBatch]);

  const loadMoreThreads = useCallback(async () => {
    if (loading || loadingMore || !hasMoreThreads) return;

    setLoadingMore(true);
    setFeedError("");
    try {
      const { hydratedThreads, stats } = await fetchThreadsBatch(threads.length, THREADS_BATCH_SIZE);
      setThreads((prev) => dedupeById([...prev, ...hydratedThreads]));
      setThreadStats((prev) => ({ ...prev, ...stats }));
      setHasMoreThreads(hydratedThreads.length === THREADS_BATCH_SIZE);
    } catch (error) {
      console.warn("[Supabase] forum load more failed:", error?.message || error);
      setFeedError("Unable to load more threads right now.");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchThreadsBatch, hasMoreThreads, loading, loadingMore, threads.length]);

  useEffect(() => {
    if (!sessionUser?.id) return;
    loadForumData();
  // loadForumData is now stable (fetchThreadsBatch uses refs); only re-run
  // when the signed-in user changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.id]);

  useEffect(() => {
    const node = loadMoreTriggerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (!target?.isIntersecting) return;
        if (selectedTag !== "all") return;
        if (loading || loadingMore || !hasMoreThreads) return;
        loadMoreThreads();
      },
      { rootMargin: "240px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreThreads, loadMoreThreads, loading, loadingMore, selectedTag]);

  const tagFilters = useMemo(() => {
    const dynamic = categories.map((category) => ({
      id: category.id,
      label: category.label,
      slug: category.slug,
    }));
    const base = [{ id: "all", label: "All" }];
    if (sessionUser?.id) {
      base.push({ id: "mine", label: "My Threads" });
    }
    return [...base, ...dynamic];
  }, [categories, sessionUser?.id]);

  const filteredThreads = useMemo(() => {
    if (selectedTag === "all") return threads;
    if (selectedTag === "mine") {
      if (!sessionUser?.id) return [];
      return threads.filter((thread) => thread.user_id === sessionUser.id);
    }
    return threads.filter((thread) =>
      (thread.categories || []).some((category) => category.id === selectedTag),
    );
  }, [threads, selectedTag, sessionUser?.id]);

  const loggedInAs = useMemo(() => {
    const metaName = sessionUser?.user_metadata?.display_name
      || sessionUser?.user_metadata?.full_name
      || sessionUser?.user_metadata?.name;
    const emailName = sessionUser?.email ? sessionUser.email.split("@")[0] : "";
    return metaName || emailName || "user";
  }, [sessionUser]);

  const topicFilters = useMemo(() => tagFilters.filter((tag) => tag.id !== "all" && tag.id !== "mine"), [tagFilters]);

  const fetchThreadById = useCallback(async (threadId) => {
    if (!threadId) return null;

    const threadResult = await supabase
      .from("forum_threads")
      .select(
        "id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))",
      )
      .eq("id", threadId)
      .maybeSingle();

    if (threadResult.error) throw threadResult.error;
    if (!threadResult.data) return null;

    let profile = null;
    if (threadResult.data.user_id) {
      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("id, display_name, organization, avatar_url")
        .eq("id", threadResult.data.user_id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;
      profile = profileResult.data || null;
      if (profile?.avatar_url) {
        const resolved = await resolveAvatarUrl(profile.avatar_url);
        profile = {
          ...profile,
          avatar_url: resolved || profile.avatar_url,
        };
      }
    }

    const categories = (threadResult.data.forum_thread_categories || [])
      .map((link) => link.forum_categories)
      .filter(Boolean);

    return {
      ...threadResult.data,
      categories,
      ...resolveAuthor({
        profile,
        userId: threadResult.data.user_id,
        sessionUser,
        sessionAvatar: sessionAvatarUrl,
      }),
    };
  }, [sessionAvatarUrl, sessionUser]);

  const toggleThreadLike = async (thread) => {
    if (!sessionUser) {
      setFeedError("Please sign in to like a thread.");
      return;
    }
    if (threadLikeBusyId === thread.id) return;

    const currentStats = threadStats[thread.id] || { likes: 0, replies: 0, userLiked: false };
    const currentlyLiked = !!currentStats.userLiked;

    setThreadLikeBusyId(thread.id);
    setFeedError("");
    try {
      if (currentlyLiked) {
        const { error } = await supabase
          .from("forum_thread_likes")
          .delete()
          .eq("thread_id", thread.id)
          .eq("user_id", sessionUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("forum_thread_likes")
          .insert({ thread_id: thread.id, user_id: sessionUser.id });
        if (error) throw error;
      }

      setThreadStats((prev) => {
        const base = prev[thread.id] || { likes: 0, replies: 0, userLiked: false };
        const nextLiked = !base.userLiked;
        return {
          ...prev,
          [thread.id]: {
            ...base,
            likes: Math.max(0, base.likes + (nextLiked ? 1 : -1)),
            userLiked: nextLiked,
          },
        };
      });
    } catch (error) {
      console.warn("[Supabase] thread like toggle failed:", error?.message || error);
      setFeedError("Unable to update thread like right now.");
    } finally {
      setThreadLikeBusyId("");
    }
  };

  const openThread = async (thread) => {
    setActiveThread(thread);
    setThreadModalVisible(true);
    window.setTimeout(() => setThreadModalActive(true), 10);
    setReplyText("");
    setReplyTarget(null);
    setReplyError("");
    setThreadLoading(true);

    try {
      const postsResult = await supabase
        .from("forum_posts")
        .select("id, thread_id, user_id, parent_post_id, body, created_at")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true });

      if (postsResult.error) throw postsResult.error;

      const posts = postsResult.data || [];
      const userIds = Array.from(new Set(posts.map((post) => post.user_id).filter(Boolean)));
      const profilesResult = userIds.length
        ? await supabase
            .from(SUPABASE_PROFILES_TABLE)
            .select("id, display_name, organization, avatar_url")
            .in("id", userIds)
        : { data: [] };

      if (profilesResult.error) throw profilesResult.error;

      const resolvedProfiles = await Promise.all(
        (profilesResult.data || []).map(async (profile) => {
          if (!profile?.avatar_url) return profile;
          const resolved = await resolveAvatarUrl(profile.avatar_url);
          return {
            ...profile,
            avatar_url: resolved || profile.avatar_url,
          };
        }),
      );

      const profileMap = makeProfileMap(resolvedProfiles);
      const postIds = posts.map((post) => post.id);
      const likesResult = postIds.length
        ? await supabase.from("forum_post_likes").select("post_id, user_id").in("post_id", postIds)
        : { data: [] };

      if (likesResult.error) throw likesResult.error;

      const likesMap = (likesResult.data || []).reduce((acc, like) => {
        if (!acc[like.post_id]) {
          acc[like.post_id] = new Set();
        }
        acc[like.post_id].add(like.user_id);
        return acc;
      }, {});

      const enrichedPosts = posts.map((post) => {
        const likedBy = likesMap[post.id] || new Set();
        return {
          ...post,
          ...resolveAuthor({
            profile: profileMap.get(post.user_id),
            userId: post.user_id,
            sessionUser,
            sessionAvatar: sessionAvatarUrl,
          }),
          likeCount: likedBy.size,
          userLiked: sessionUser?.id ? likedBy.has(sessionUser.id) : false,
        };
      });

      setThreadPosts(enrichedPosts);
    } catch (error) {
      console.warn("[Supabase] thread load failed:", error?.message || error);
      setReplyError("Unable to load thread replies.");
    } finally {
      setThreadLoading(false);
    }
  };

  const closeThread = () => {
    setThreadModalActive(false);
    window.setTimeout(() => {
      setThreadModalVisible(false);
      setActiveThread(null);
      setThreadPosts([]);
      setReplyText("");
      setReplyTarget(null);
      setReplyError("");
    }, THREAD_MODAL_ANIMATION_MS);
  };

  const handleOpenNotification = useCallback(async (notification) => {
    if (!notification?.thread_id) {
      setNotificationsError("This notification has no linked thread.");
      return;
    }

    try {
      if (!notification.is_read) {
        await markNotificationAsRead(notification.id);
      }

      const existingThread = threads.find((item) => item.id === notification.thread_id);
      const targetThread = existingThread || await fetchThreadById(notification.thread_id);

      if (!targetThread) {
        setNotificationsError("Thread is no longer available.");
        return;
      }

      if (!existingThread) {
        setThreads((prev) => dedupeById([targetThread, ...prev]));
      }

      setNotificationsVisible(false);
      await openThread(targetThread);
    } catch (error) {
      console.warn("[Supabase] notification open failed:", error?.message || error);
      setNotificationsError("Unable to open this notification right now.");
    }
  }, [fetchThreadById, markNotificationAsRead, openThread, setNotificationsError, threads]);

  useEffect(() => {
    if (!sessionUser?.id || !pendingOpenThreadId) return;

    let active = true;

    const openPendingThread = async () => {
      try {
        if (pendingNotificationId) {
          const source = notifications.find((item) => item.id === pendingNotificationId);
          if (source && !source.is_read) {
            await markNotificationAsRead(pendingNotificationId);
          }
        }

        const existingThread = threads.find((item) => item.id === pendingOpenThreadId);
        const targetThread = existingThread || await fetchThreadById(pendingOpenThreadId);
        if (!active || !targetThread) return;

        if (!existingThread) {
          setThreads((prev) => dedupeById([targetThread, ...prev]));
        }

        await openThread(targetThread);
      } catch (error) {
        if (active) {
          setNotificationsError("Unable to open the selected notification thread.");
        }
      } finally {
        if (active) {
          navigate(location.pathname, { replace: true, state: null });
        }
      }
    };

    openPendingThread();

    return () => {
      active = false;
    };
  }, [
    fetchThreadById,
    location.pathname,
    markNotificationAsRead,
    navigate,
    notifications,
    openThread,
    pendingNotificationId,
    pendingOpenThreadId,
    setNotificationsError,
    threads,
  ]);

  const deleteThread = async (thread) => {
    if (!sessionUser?.id) {
      setFeedError("Please sign in to delete your thread.");
      addToast("Please sign in to delete your thread.", "error");
      return;
    }
    if (!thread?.id || thread.user_id !== sessionUser.id) {
      setFeedError("You can only delete your own thread.");
      addToast("You can only delete your own thread.", "error");
      return;
    }
    if (threadDeleteBusyId === thread.id) return;

    setThreadDeleteBusyId(thread.id);
    setFeedError("");
    try {
      const { error } = await supabase
        .from("forum_threads")
        .delete()
        .eq("id", thread.id)
        .eq("user_id", sessionUser.id);

      if (error) throw error;

      setThreads((prev) => prev.filter((item) => item.id !== thread.id));
      setThreadStats((prev) => {
        const next = { ...prev };
        delete next[thread.id];
        return next;
      });
      if (activeThread?.id === thread.id) {
        closeThread();
      }
      addToast("Thread deleted.", "success");
    } catch (error) {
      console.warn("[Supabase] delete thread failed:", error?.message || error);
      setFeedError("Unable to delete thread right now.");
      addToast("Unable to delete thread right now.", "error");
    } finally {
      setThreadDeleteBusyId("");
    }
  };

  const requestDeleteThread = useCallback((thread) => {
    if (!sessionUser?.id) {
      setFeedError("Please sign in to delete your thread.");
      addToast("Please sign in to delete your thread.", "error");
      return;
    }
    if (!thread?.id || thread.user_id !== sessionUser.id) {
      setFeedError("You can only delete your own thread.");
      addToast("You can only delete your own thread.", "error");
      return;
    }

    addToast("Delete this thread and all replies permanently?", "warning", {
      duration: 0,
      actionLabel: "Delete",
      onAction: () => {
        deleteThread(thread);
      },
    });
  }, [addToast, deleteThread, sessionUser?.id]);

  const handleSendReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) {
      setReplyError("Reply cannot be empty.");
      return;
    }
    if (!activeThread) {
      setReplyError("Select a thread first.");
      return;
    }
    if (!sessionUser) {
      setReplyError("Please sign in to reply.");
      return;
    }
    if (containsBadWords(trimmed)) {
      setReplyError("Reply contains inappropriate language. Please revise it.");
      return;
    }

    setReplyLoading(true);
    setReplyError("");

    try {
      const insertResult = await supabase
        .from("forum_posts")
        .insert({
          thread_id: activeThread.id,
          user_id: sessionUser.id,
          body: trimmed,
          parent_post_id: replyTarget?.id || null,
        })
        .select("id, thread_id, user_id, parent_post_id, body, created_at")
        .single();

      if (insertResult.error) throw insertResult.error;

      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("id, display_name, organization, avatar_url")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;

      const newPost = {
        ...insertResult.data,
        ...resolveAuthor({
          profile: profileResult.data
            ? {
                ...profileResult.data,
                avatar_url:
                  (await resolveAvatarUrl(profileResult.data.avatar_url)) || profileResult.data.avatar_url || "",
              }
            : null,
          userId: sessionUser.id,
          sessionUser,
          sessionAvatar: sessionAvatarUrl,
          fallbackName: "You",
        }),
        likeCount: 0,
        userLiked: false,
      };

      setThreadPosts((prev) => [...prev, newPost]);
      setReplyText("");
      setReplyTarget(null);
      setThreadStats((prev) => {
        const current = prev[activeThread.id] || { replies: 0, likes: 0 };
        return {
          ...prev,
          [activeThread.id]: { ...current, replies: current.replies + 1 },
        };
      });
    } catch (error) {
      console.warn("[Supabase] reply insert failed:", error?.message || error);
      setReplyError("Unable to post reply right now.");
    } finally {
      setReplyLoading(false);
    }
  };

  const toggleLike = async (post) => {
    if (!sessionUser) {
      setReplyError("Please sign in to like a reply.");
      return;
    }
    if (likeBusyId === post.id) return;

    setLikeBusyId(post.id);
    setReplyError("");
    try {
      if (post.userLiked) {
        const { error } = await supabase
          .from("forum_post_likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", sessionUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("forum_post_likes")
          .insert({ post_id: post.id, user_id: sessionUser.id });
        if (error) throw error;
      }

      setThreadPosts((prev) =>
        prev.map((item) => {
          if (item.id !== post.id) return item;
          const nextLiked = !item.userLiked;
          const nextCount = Math.max(0, item.likeCount + (nextLiked ? 1 : -1));
          return { ...item, userLiked: nextLiked, likeCount: nextCount };
        }),
      );

    } catch (error) {
      console.warn("[Supabase] like toggle failed:", error?.message || error);
      setReplyError("Unable to update like right now.");
    } finally {
      setLikeBusyId("");
    }
  };

  const handleCreateThread = async () => {
    const trimmedTitle = composeTitle.trim();
    const trimmedBody = composeBody.trim();

    if (!trimmedTitle || !trimmedBody) {
      setComposeError("Title and details are required.");
      return;
    }
    if (!sessionUser) {
      setComposeError("Please sign in to start a thread.");
      return;
    }
    if (!composeCategories.length) {
      setComposeError("Select at least one category.");
      return;
    }
    if (containsBadWords(`${trimmedTitle} ${trimmedBody}`)) {
      setComposeError("Thread contains inappropriate language. Please revise it.");
      return;
    }

    setComposeLoading(true);
    setComposeError("");
    try {
      const insertResult = await supabase
        .from("forum_threads")
        .insert({
          user_id: sessionUser.id,
          title: trimmedTitle,
          body: trimmedBody,
        })
        .select("id, user_id, title, body, created_at, updated_at")
        .single();

      if (insertResult.error) throw insertResult.error;

      const threadId = insertResult.data.id;
      const categoryPayload = composeCategories.map((categoryId) => ({
        thread_id: threadId,
        category_id: categoryId,
      }));
      if (categoryPayload.length) {
        const { error } = await supabase.from("forum_thread_categories").insert(categoryPayload);
        if (error) throw error;
      }

      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select("id, display_name, organization, avatar_url")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;

      const selectedCategories = categories.filter((category) => composeCategories.includes(category.id));
      const newThread = {
        ...insertResult.data,
        categories: selectedCategories,
        ...resolveAuthor({
          profile: profileResult.data
            ? {
                ...profileResult.data,
                avatar_url:
                  (await resolveAvatarUrl(profileResult.data.avatar_url)) || profileResult.data.avatar_url || "",
              }
            : null,
          userId: sessionUser.id,
          sessionUser,
          sessionAvatar: sessionAvatarUrl,
          fallbackName: "You",
        }),
      };

      setThreads((prev) => [newThread, ...prev]);
      setThreadStats((prev) => ({
        ...prev,
        [threadId]: { replies: 0, likes: 0, userLiked: false },
      }));

      setComposeTitle("");
      setComposeBody("");
      setComposeCategories([]);
      closeCompose();
    } catch (error) {
      console.warn("[Supabase] create thread failed:", error?.message || error);
      setComposeError("Unable to start the thread right now.");
    } finally {
      setComposeLoading(false);
    }
  };

  const toggleComposeCategory = (categoryId) => {
    setComposeCategories((prev) => {
      if (prev.includes(categoryId)) {
        return prev.filter((id) => id !== categoryId);
      }
      if (prev.length >= MAX_CATEGORIES) {
        setComposeError(`Select up to ${MAX_CATEGORIES} categories.`);
        return prev;
      }
      setComposeError("");
      return [...prev, categoryId];
    });
  };

  return (
    <section className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border-2 border-sky-300 bg-white p-4 shadow-sm">
          <div className="mb-2 flex justify-center">
            <Lottie
              animationData={forumAnim}
              loop
              autoplay
              className="h-24 w-24"
            />
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Community</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Forum feed</h1>
          <p className="mt-1 max-w-3xl text-xs text-slate-600">
            Share field signals, lab wins, and policy drafts in one workflow.
          </p>
          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-sky-200 bg-slate-100 text-xs font-bold text-slate-700">
                <Avatar src={sessionAvatarUrl} name={loggedInAs} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">Hi there 👋</p>
                <p className="truncate text-sm font-semibold text-slate-900">{loggedInAs}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsVisible(true);
                    refreshNotifications();
                  }}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-sky-200 bg-white text-sky-700 transition hover:border-sky-300 hover:bg-sky-50"
                  aria-label="Open notifications"
                  title="Notifications"
                >
                  <IconBell className="h-4 w-4" />
                  {unreadNotificationsCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
                      {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
                    </span>
                  ) : null}
                </button>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                  Forum Feed
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {tagFilters.filter((tag) => tag.id === "all" || tag.id === "mine").map((tag) => {
              const active = selectedTag === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setSelectedTag(tag.id)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    active
                      ? "border-sky-200 bg-sky-50 text-sky-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>

          <div className="flex w-full items-center justify-end gap-2 md:w-auto">
            <button
              type="button"
              onClick={loadForumData}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition hover:border-slate-300"
            >
              <IconRefresh className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCompose}
              className="group flex min-w-[220px] flex-1 items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-500 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 active:scale-[0.98] md:max-w-[340px] md:flex-none"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <IconPlus className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">Start a thread...</span>
            </button>
          </div>
        </div>

        {topicFilters.length > 0 ? (
          <div className="overflow-hidden rounded-3xl border-2 border-cyan-300 bg-white">
            <button
              type="button"
              onClick={() => setCategoriesOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600"><IconTag className="h-3.5 w-3.5" />Browse Topics</p>
                {selectedTag !== "all" && selectedTag !== "mine" ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                    1 active
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {selectedTag !== "all" && selectedTag !== "mine" ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedTag("all");
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Clear
                  </button>
                ) : null}
                <IconChevron className={`h-4 w-4 text-slate-500 transition ${categoriesOpen ? "rotate-180" : "rotate-0"}`} />
              </div>
            </button>

            {categoriesOpen ? (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 pb-4 pt-3">
                {topicFilters.map((tag) => {
                  const active = selectedTag === tag.id;
                  const iconKey = resolveTopicIconKey(tag.slug, tag.label);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => setSelectedTag(tag.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                        active
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {renderTopicIcon(iconKey, "h-3.5 w-3.5")}
                      {tag.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {feedError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{feedError}</div>
        ) : null}

        <div className="grid gap-4">
          {!loading && filteredThreads.length === 0 ? (
            <div className="rounded-2xl border-2 border-sky-200 bg-white px-5 py-8 text-sm text-slate-600 shadow-sm">
              No threads yet. Start a thread and share what your team is seeing in the field.
            </div>
          ) : null}

          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-cyan-200 bg-white px-5 py-8 text-sm text-slate-600 shadow-sm">
              {loadingAnimData ? (
                <Lottie animationData={loadingAnimData} loop autoplay className="h-20 w-20" />
              ) : null}
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Loading forum...</p>
            </div>
          ) : null}

          {filteredThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              stats={threadStats[thread.id]}
              onOpenThread={() => openThread(thread)}
              onToggleThreadLike={() => toggleThreadLike(thread)}
              threadLikeBusyId={threadLikeBusyId}
              canDelete={thread.user_id === sessionUser?.id}
              onDeleteThread={() => requestDeleteThread(thread)}
              deleteBusyId={threadDeleteBusyId}
            />
          ))}

          {!loading && selectedTag === "all" ? (
            <div ref={loadMoreTriggerRef} className="h-6 w-full" aria-hidden="true" />
          ) : null}

          {loadingMore ? (
            <div className="flex items-center justify-center rounded-2xl border-2 border-cyan-300 bg-white px-5 py-5 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 shadow-sm">
              Loading more threads...
            </div>
          ) : null}

          {!loading && selectedTag === "all" && !hasMoreThreads && filteredThreads.length > 0 ? (
            <div className="rounded-2xl border-2 border-sky-200 bg-white px-5 py-4 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 shadow-sm">
              You’ve reached the end
            </div>
          ) : null}
        </div>
      </div>

      {composeVisible ? (
        <div className={`fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/60 px-4 py-10 transition-opacity duration-200 ${composeModalActive ? "opacity-100" : "opacity-0"}`}>
          <div className={`w-full max-w-3xl rounded-3xl border-2 border-sky-200 bg-white p-6 shadow-xl transition-all duration-200 ${composeModalActive ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-900"><IconPlus className="h-5 w-5 text-sky-700" />Start a thread</h2>
                <p className="mt-1 text-xs text-slate-500">Share your thoughts with the community.</p>
              </div>
              <button
                type="button"
                onClick={closeCompose}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600"
              >
                <IconClose className="h-3.5 w-3.5" />
                Close
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-sky-200 bg-slate-100">
                <Avatar src={sessionAvatarUrl} name={loggedInAs} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{loggedInAs}</p>
                <p className="inline-flex items-center gap-1 text-xs text-sky-700"><IconGlobe className="h-3.5 w-3.5" />Posting to Community</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                <IconUsers className="h-3 w-3" /> Public
              </span>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"><IconPencil className="h-3.5 w-3.5" />Thread title</span>
                <input
                  value={composeTitle}
                  onChange={(event) => setComposeTitle(event.target.value)}
                  placeholder="Summarize the issue or idea"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300"
                />
              </label>

              <label className="block space-y-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"><IconDocument className="h-3.5 w-3.5" />Details</span>
                <textarea
                  value={composeBody}
                  onChange={(event) => setComposeBody(event.target.value)}
                  placeholder="Share context, data points, or questions"
                  rows={5}
                  className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300"
                />
              </label>

              <div>
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <IconTag className="h-3.5 w-3.5" />
                  Categories (up to {MAX_CATEGORIES})
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories.map((category) => {
                    const active = composeCategories.includes(category.id);
                    const iconKey = resolveTopicIconKey(category.slug, category.label);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleComposeCategory(category.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                          active
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {renderTopicIcon(iconKey, "h-3.5 w-3.5")}
                        {category.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {composeError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {composeError}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleCreateThread}
                disabled={composeLoading}
                className="w-full rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {composeLoading ? "Posting..." : "Post thread"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {threadModalVisible && activeThread ? (
        <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 px-4 py-10 transition-opacity duration-200 ${threadModalActive ? "opacity-100" : "opacity-0"}`}>
          <div className={`w-full max-w-4xl rounded-3xl border-2 border-cyan-300 bg-slate-50 p-6 shadow-xl transition-all duration-200 ${threadModalActive ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-900"><IconUsers className="h-5 w-5 text-sky-700" />Thread</h2>
              <button
                type="button"
                onClick={closeThread}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600"
              >
                <IconClose className="h-3.5 w-3.5" />
                Close
              </button>
            </div>

            <div className="mt-5 rounded-3xl border-2 border-sky-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    <Avatar src={activeThread.authorAvatar} name={activeThread.authorName} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{activeThread.authorName}</p>
                    <p className="text-xs text-slate-500">{activeThread.authorOrg || "Community"}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-500">{formatRelativeTime(activeThread.created_at)}</span>
              </div>

              <h3 className="mt-4 text-lg font-semibold text-slate-900">{activeThread.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{activeThread.body}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {(activeThread.categories || []).map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700"
                  >
                    #{tag.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"><IconReply className="h-3.5 w-3.5" />Replies</p>
              {threadLoading ? (
                <div className="rounded-2xl border-2 border-cyan-200 bg-white px-4 py-6 text-sm text-slate-600">
                  Loading replies...
                </div>
              ) : null}

              {!threadLoading && threadPosts.length === 0 ? (
                <div className="rounded-2xl border-2 border-sky-200 bg-white px-4 py-6 text-sm text-slate-600">
                  No replies yet. Be the first to respond.
                </div>
              ) : null}

              {!threadLoading
                ? threadPosts.map((item) => (
                    <article key={item.id} className="rounded-3xl border-2 border-sky-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                            <Avatar src={item.authorAvatar} name={item.authorName} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{item.authorName}</p>
                            <p className="text-xs text-slate-500">{item.authorOrg || "Community"}</p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-500">{formatRelativeTime(item.created_at)}</span>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.body}</p>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => toggleLike(item)}
                            disabled={likeBusyId === item.id}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                              item.userLiked
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {item.userLiked ? <IconHeartFilled className="h-3.5 w-3.5" /> : <IconHeart className="h-3.5 w-3.5" />}
                            Like {item.likeCount}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplyTarget(item)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700"
                          >
                            <IconReply className="h-3.5 w-3.5" />
                            Reply
                          </button>
                        </div>
                        {item.parent_post_id ? (
                          <span className="text-xs text-slate-500">Reply</span>
                        ) : null}
                      </div>
                    </article>
                  ))
                : null}
            </div>

            <div className="mt-5 rounded-3xl border-2 border-cyan-200 bg-white p-4">
              {replyTarget ? (
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-sky-700">Replying to {replyTarget.authorName}</p>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

              <textarea
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Write a reply"
                rows={4}
                className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300"
              />

              {replyError ? (
                <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {replyError}
                </p>
              ) : null}

              <button
                type="button"
                onClick={handleSendReply}
                disabled={replyLoading}
                className="mt-4 w-full rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {replyLoading ? "Sending..." : "Send reply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} onAction={runToastAction} />

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
