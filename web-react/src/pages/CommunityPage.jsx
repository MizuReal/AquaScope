import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import Lottie from "lottie-react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import forumAnim from "@/assets/lottie/forumanim.json";

const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const MAX_CATEGORIES = 5;
const configMissing = !supabase || !isSupabaseConfigured;

const HIGHLIGHTS = [
  "AI-assisted water quality insights powered by field data and lab checks.",
  "Automated microbial risk triage with explainable parameter flags.",
  "OCR + fiducial capture streamlines sampling and reporting workflows.",
];

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
  <svg {...iconProps} className={className}>
    <path d="M14 5h5v5" />
    <path d="M10 14 19 5" />
    <path d="M19 14v5h-14v-14h5" />
  </svg>
);

const IconHeart = ({ className = "h-4 w-4" }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
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

const makeProfileMap = (profiles = []) => {
  return new Map(profiles.map((profile) => [profile.id, profile]));
};

const profileToAuthor = (profile, fallbackName = "Community member") => {
  return {
    authorName: profile?.display_name || fallbackName,
    authorOrg: profile?.organization || "",
    authorAvatar: profile?.avatar_url || "",
  };
};

const sessionUserToAuthor = (user, fallbackName = "Community member") => {
  const metadata = user?.user_metadata || {};
  return {
    authorName:
      metadata.display_name ||
      metadata.full_name ||
      metadata.name ||
      user?.email?.split("@")[0] ||
      fallbackName,
    authorOrg: metadata.organization || "",
    authorAvatar: metadata.avatar_url || metadata.picture || "",
  };
};

const buildProfilePayloadFromUser = (user) => {
  const metadata = user?.user_metadata || {};
  return {
    id: user?.id,
    display_name:
      metadata.display_name ||
      metadata.full_name ||
      metadata.name ||
      user?.email?.split("@")[0] ||
      null,
    organization: metadata.organization || null,
    avatar_url: metadata.avatar_url || metadata.picture || null,
  };
};

const resolveAuthor = ({ profile, userId, sessionUser, fallbackName = "Community member" }) => {
  if (profile) {
    return profileToAuthor(profile, fallbackName);
  }
  if (sessionUser?.id && userId === sessionUser.id) {
    return sessionUserToAuthor(sessionUser, fallbackName);
  }
  return profileToAuthor(null, fallbackName);
};

function Avatar({ src, name }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "Avatar"}
        className="h-full w-full object-cover"
      />
    );
  }
  return <span className="text-xs font-semibold text-slate-700">{buildInitials(name)}</span>;
}

function StatPill({ label, value, tone = "neutral", icon, onClick, title }) {
  const toneClass =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-slate-200 bg-slate-100 text-slate-700";

  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${toneClass} ${onClick ? "transition hover:brightness-95" : ""}`}
    >
      {icon ? <span className="text-current">{icon}</span> : null}
      <span className="font-medium">{label}</span>
      <span className="font-semibold">{value}</span>
    </Comp>
  );
}

function ThreadCard({ thread, stats, onOpenThread }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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
            icon={<IconHeart className="h-3.5 w-3.5" />}
            onClick={onOpenThread}
            title="Open thread to like replies"
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
        <button
          type="button"
          onClick={onOpenThread}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
        >
          <IconOpen className="h-3.5 w-3.5" />
          Open thread
        </button>
      </div>
    </article>
  );
}

export default function CommunityPage() {
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [sessionUser, setSessionUser] = useState(null);

  const [categories, setCategories] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadStats, setThreadStats] = useState({});
  const [selectedTag, setSelectedTag] = useState("all");
  const [loading, setLoading] = useState(false);
  const [feedError, setFeedError] = useState("");

  const [threadModalVisible, setThreadModalVisible] = useState(false);
  const [activeThread, setActiveThread] = useState(null);
  const [threadPosts, setThreadPosts] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);

  const [composeVisible, setComposeVisible] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeCategories, setComposeCategories] = useState([]);
  const [composeError, setComposeError] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [likeBusyId, setLikeBusyId] = useState("");
  const [categoriesOpen, setCategoriesOpen] = useState(true);

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

  useEffect(() => {
    if (configMissing) {
      return;
    }

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
        setAuthReady(false);
        setChecking(false);
        return;
      }

      setSessionUser(data.session.user);
      await syncSessionProfile(data.session.user);
      setAuthReady(true);
      setChecking(false);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (!session?.user) {
        if (event === "SIGNED_OUT") {
          setAuthReady(false);
          setSessionUser(null);
        }
      } else {
        setAuthReady(true);
        setSessionUser(session.user);
        syncSessionProfile(session.user);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [syncSessionProfile]);

  const loadForumData = useCallback(async () => {
    setLoading(true);
    setFeedError("");

    try {
      const [categoryResult, threadResult] = await Promise.all([
        supabase
          .from("forum_categories")
          .select("id, slug, label, is_active")
          .eq("is_active", true)
          .order("label", { ascending: true }),
        supabase
          .from("forum_threads")
          .select(
            "id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))",
          )
          .order("created_at", { ascending: false }),
      ]);

      if (categoryResult.error) throw categoryResult.error;
      if (threadResult.error) throw threadResult.error;

      const activeCategories = categoryResult.data || [];
      const rawThreads = threadResult.data || [];

      const userIds = Array.from(new Set(rawThreads.map((thread) => thread.user_id).filter(Boolean)));

      const profilesResult = userIds.length
        ? await supabase
            .from(SUPABASE_PROFILES_TABLE)
            .select("id, display_name, organization, avatar_url")
            .in("id", userIds)
        : { data: [] };

      if (profilesResult.error) throw profilesResult.error;

      const profileMap = makeProfileMap(profilesResult.data || []);

      const hydratedThreads = rawThreads.map((thread) => {
        const categoryLinks = thread.forum_thread_categories || [];
        const mappedCategories = categoryLinks.map((link) => link.forum_categories).filter(Boolean);
        return {
          ...thread,
          categories: mappedCategories,
          ...resolveAuthor({
            profile: profileMap.get(thread.user_id),
            userId: thread.user_id,
            sessionUser,
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

      const postIds = postsData.map((post) => post.id);
      const likesCount = {};
      if (postIds.length) {
        const likesResult = await supabase
          .from("forum_post_likes")
          .select("post_id, forum_posts(thread_id)")
          .in("post_id", postIds);

        if (likesResult.error) throw likesResult.error;

        (likesResult.data || []).forEach((row) => {
          const threadId = row.forum_posts?.thread_id;
          if (!threadId) return;
          likesCount[threadId] = (likesCount[threadId] || 0) + 1;
        });
      }

      const stats = hydratedThreads.reduce((acc, thread) => {
        acc[thread.id] = {
          replies: repliesCount[thread.id] || 0,
          likes: likesCount[thread.id] || 0,
        };
        return acc;
      }, {});

      setCategories(activeCategories);
      setThreads(hydratedThreads);
      setThreadStats(stats);
    } catch (error) {
      console.warn("[Supabase] forum load failed:", error?.message || error);
      setFeedError("Unable to load forum right now.");
    } finally {
      setLoading(false);
    }
  }, [sessionUser]);

  useEffect(() => {
    if (!authReady) return;
    loadForumData();
  }, [authReady, loadForumData]);

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

  const openThread = async (thread) => {
    setActiveThread(thread);
    setThreadModalVisible(true);
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

      const profileMap = makeProfileMap(profilesResult.data || []);
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
    setThreadModalVisible(false);
    setActiveThread(null);
    setThreadPosts([]);
    setReplyText("");
    setReplyTarget(null);
    setReplyError("");
  };

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
          profile: profileResult.data,
          userId: sessionUser.id,
          sessionUser,
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

      if (activeThread) {
        setThreadStats((prev) => {
          const current = prev[activeThread.id] || { replies: 0, likes: 0 };
          return {
            ...prev,
            [activeThread.id]: {
              ...current,
              likes: Math.max(0, current.likes + (post.userLiked ? -1 : 1)),
            },
          };
        });
      }
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
          profile: profileResult.data,
          userId: sessionUser.id,
          sessionUser,
          fallbackName: "You",
        }),
      };

      setThreads((prev) => [newThread, ...prev]);
      setThreadStats((prev) => ({
        ...prev,
        [threadId]: { replies: 0, likes: 0 },
      }));

      setComposeTitle("");
      setComposeBody("");
      setComposeCategories([]);
      setComposeVisible(false);
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

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to .env so we can secure the forum route.
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
          <p className="text-sm text-slate-500">Log in to access the community forum.</p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex justify-center">
            <Lottie
              animationData={forumAnim}
              loop
              autoplay
              className="h-40 w-40"
            />
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Community</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Forum feed</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Share field signals, lab wins, and policy drafts in one workflow.
          </p>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">
                {buildInitials(loggedInAs)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">Hi there 👋</p>
                <p className="truncate text-sm font-semibold text-slate-900">{loggedInAs}</p>
              </div>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                Forum Feed
              </span>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {HIGHLIGHTS.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {item}
              </div>
            ))}
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
              onClick={() => setComposeVisible(true)}
              className="group flex min-w-[220px] flex-1 items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-500 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 md:max-w-[340px] md:flex-none"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <IconPlus className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">Start a conversation...</span>
            </button>
          </div>
        </div>

        {topicFilters.length > 0 ? (
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setCategoriesOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">Browse Topics</p>
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
                <span className="text-slate-500">{categoriesOpen ? "˄" : "˅"}</span>
              </div>
            </button>

            {categoriesOpen ? (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 pb-4 pt-3">
                {topicFilters.map((tag) => {
                  const active = selectedTag === tag.id;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => setSelectedTag(tag.id)}
                      className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
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
            ) : null}
          </div>
        ) : null}

        {feedError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{feedError}</div>
        ) : null}

        <div className="grid gap-4">
          {!loading && filteredThreads.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-sm text-slate-600 shadow-sm">
              No threads yet. Start a thread and share what your team is seeing in the field.
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-sm text-slate-600 shadow-sm">
              Loading forum...
            </div>
          ) : null}

          {filteredThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              stats={threadStats[thread.id]}
              onOpenThread={() => openThread(thread)}
            />
          ))}
        </div>
      </div>

      {composeVisible ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/60 px-4 py-10">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-slate-900">Start a thread</h2>
              <button
                type="button"
                onClick={() => setComposeVisible(false)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600"
              >
                <IconClose className="h-3.5 w-3.5" />
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Thread title</span>
                <input
                  value={composeTitle}
                  onChange={(event) => setComposeTitle(event.target.value)}
                  placeholder="Summarize the issue or idea"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Details</span>
                <textarea
                  value={composeBody}
                  onChange={(event) => setComposeBody(event.target.value)}
                  placeholder="Share context, data points, or questions"
                  rows={5}
                  className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300"
                />
              </label>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Categories (up to {MAX_CATEGORIES})
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories.map((category) => {
                    const active = composeCategories.includes(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleComposeCategory(category.id)}
                        className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                          active
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 px-4 py-10">
          <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900">Thread</h2>
              <button
                type="button"
                onClick={closeThread}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600"
              >
                <IconClose className="h-3.5 w-3.5" />
                Close
              </button>
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
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
              {threadLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
                  Loading replies...
                </div>
              ) : null}

              {!threadLoading && threadPosts.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
                  No replies yet. Be the first to respond.
                </div>
              ) : null}

              {!threadLoading
                ? threadPosts.map((item) => (
                    <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-4">
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
                            <IconHeart className="h-3.5 w-3.5" />
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

            <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4">
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
    </section>
  );
}
