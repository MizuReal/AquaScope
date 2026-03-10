import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const configMissing = !supabase || !isSupabaseConfigured;
const DEFAULT_PAGE_SIZE = 20;
const SUPABASE_PROFILES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";

/* ── tiny SVG icons ── */

const IconLock = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);
const IconUnlock = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
);
const IconSearch = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
const IconChevron = ({ className = "h-4 w-4", direction = "right" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={`${className} transition-transform ${direction === "down" ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
);
const IconTrash = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
);

function formatRelativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function AdminForumPage() {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | locked | unlocked
  const [lockModalThread, setLockModalThread] = useState(null);
  const [lockReason, setLockReason] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const successTimer = useRef(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedPosts, setExpandedPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [deleteModalThread, setDeleteModalThread] = useState(null);
  const [deletingId, setDeletingId] = useState("");

  /* pagination */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  /* stats (unfiltered counts for the summary bar) */
  const [totalThreads, setTotalThreads] = useState(0);
  const [lockedTotal, setLockedTotal] = useState(0);

  /* debounce search – also resets page to 1 */
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  /* ── fetch threads (paginated + server-filtered) ── */
  const loadThreads = useCallback(async () => {
    if (configMissing) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const start = (page - 1) * pageSize;
      const end = start + pageSize - 1;

      let query = supabase
        .from("forum_threads")
        .select(
          "id, user_id, title, body, is_locked, lock_reason, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))",
          { count: "exact" },
        )
        .order("created_at", { ascending: false });

      if (filter === "locked") query = query.eq("is_locked", true);
      if (filter === "unlocked") query = query.eq("is_locked", false);
      if (debouncedSearch) query = query.ilike("title", `%${debouncedSearch}%`);

      query = query.range(start, end);

      const { data, error: err, count } = await query;
      if (err) throw err;

      const rows = data || [];
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      let profileMap = new Map();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("id, display_name, organization")
          .in("id", userIds);
        (profiles || []).forEach((p) => profileMap.set(p.id, p));
      }

      setThreads(
        rows.map((t) => {
          const profile = profileMap.get(t.user_id);
          const categories = (t.forum_thread_categories || [])
            .map((link) => link.forum_categories)
            .filter(Boolean);
          return {
            ...t,
            authorName: profile?.display_name || "Unknown",
            authorOrg: profile?.organization || "",
            categories,
          };
        }),
      );
      setTotalCount(Number.isFinite(count) ? count : 0);
    } catch (e) {
      setError(e?.message || "Failed to load threads.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter, debouncedSearch]);

  /* ── fetch stats (total + locked counts, unfiltered) ── */
  const loadStats = useCallback(async () => {
    if (configMissing) return;
    try {
      const [totalRes, lockedRes] = await Promise.all([
        supabase.from("forum_threads").select("id", { count: "exact", head: true }),
        supabase.from("forum_threads").select("id", { count: "exact", head: true }).eq("is_locked", true),
      ]);
      setTotalThreads(Number.isFinite(totalRes.count) ? totalRes.count : 0);
      setLockedTotal(Number.isFinite(lockedRes.count) ? lockedRes.count : 0);
    } catch (_) { /* stats are non-critical */ }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { loadStats(); }, [loadStats]);

  /* ── realtime refresh ── */
  useEffect(() => {
    if (configMissing) return;
    const channel = supabase
      .channel("admin-forum-threads")
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_threads" }, () => {
        loadThreads();
        loadStats();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadThreads, loadStats]);

  /* ── flash success message ── */
  const flash = (msg) => {
    setSuccessMsg(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessMsg(""), 3500);
  };

  /* ── toggle lock ── */
  const toggleLock = async (thread, reason = "") => {
    if (busyId) return;
    setBusyId(thread.id);
    setError("");
    try {
      const nextLocked = !thread.is_locked;
      const payload = {
        is_locked: nextLocked,
        lock_reason: nextLocked ? (reason.trim() || "Thread locked") : null,
      };
      const { error: err } = await supabase
        .from("forum_threads")
        .update(payload)
        .eq("id", thread.id);
      if (err) throw err;
      setThreads((prev) =>
        prev.map((t) => (t.id === thread.id ? { ...t, ...payload } : t)),
      );
      loadStats();
      flash(nextLocked ? `Locked: "${thread.title}"` : `Unlocked: "${thread.title}"`);
    } catch (e) {
      setError(e?.message || "Failed to update thread lock state.");
    } finally {
      setBusyId("");
    }
  };

  /* ── lock with reason modal confirm ── */
  const confirmLockWithReason = () => {
    if (!lockModalThread) return;
    toggleLock(lockModalThread, lockReason);
    setLockModalThread(null);
    setLockReason("");
  };

  /* ── toggle thread expand / load posts ── */
  const toggleExpand = async (threadId) => {
    if (expandedId === threadId) { setExpandedId(null); return; }
    setExpandedId(threadId);
    setExpandedPosts([]);
    setLoadingPosts(true);
    try {
      const { data: posts, error: err } = await supabase
        .from("forum_posts")
        .select("id, user_id, body, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (err) throw err;
      const userIds = [...new Set((posts || []).map((p) => p.user_id).filter(Boolean))];
      let profileMap = new Map();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("id, display_name")
          .in("id", userIds);
        (profiles || []).forEach((p) => profileMap.set(p.id, p));
      }
      setExpandedPosts(
        (posts || []).map((p) => ({
          ...p,
          authorName: profileMap.get(p.user_id)?.display_name || "Unknown",
        })),
      );
    } catch {
      setExpandedPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  };

  /* ── delete a single post ── */
  const deletePost = async (postId) => {
    if (deletingId) return;
    setDeletingId(postId);
    try {
      await supabase.from("forum_post_likes").delete().eq("post_id", postId);
      const { error: err } = await supabase.from("forum_posts").delete().eq("id", postId);
      if (err) throw err;
      setExpandedPosts((prev) => prev.filter((p) => p.id !== postId));
      flash("Post deleted.");
    } catch (e) {
      setError(e?.message || "Failed to delete post.");
    } finally {
      setDeletingId("");
    }
  };

  /* ── delete entire thread (cascade) ── */
  const deleteThread = async (thread) => {
    if (deletingId) return;
    setDeletingId(thread.id);
    setError("");
    try {
      const { data: posts } = await supabase.from("forum_posts").select("id").eq("thread_id", thread.id);
      const postIds = (posts || []).map((p) => p.id);
      if (postIds.length) {
        await supabase.from("forum_post_likes").delete().in("post_id", postIds);
      }
      await supabase.from("forum_posts").delete().eq("thread_id", thread.id);
      await supabase.from("forum_thread_likes").delete().eq("thread_id", thread.id);
      await supabase.from("forum_thread_categories").delete().eq("thread_id", thread.id);
      const { error: err } = await supabase.from("forum_threads").delete().eq("id", thread.id);
      if (err) throw err;
      setThreads((prev) => prev.filter((t) => t.id !== thread.id));
      setTotalCount((c) => c - 1);
      if (expandedId === thread.id) setExpandedId(null);
      loadStats();
      flash(`Deleted: "${thread.title}"`);
    } catch (e) {
      setError(e?.message || "Failed to delete thread.");
    } finally {
      setDeletingId("");
      setDeleteModalThread(null);
    }
  };

  /* ── pagination computed ── */
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(totalCount, page * pageSize);

  /* ── render ── */
  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header>
        <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Admin Panel</p>
        <h1 className="text-3xl font-semibold text-slate-900">Forum Thread Control</h1>
        <p className="mt-2 text-sm text-slate-500">
          View, lock, unlock, or delete community threads and posts.
        </p>
      </header>

      {/* stats bar */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
          Total: <strong>{totalThreads}</strong>
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Locked: <strong>{lockedTotal}</strong>
        </span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Open: <strong>{totalThreads - lockedTotal}</strong>
        </span>
      </div>

      {/* toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads by title, author..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(1); }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-300"
        >
          <option value="all">All threads</option>
          <option value="locked">Locked only</option>
          <option value="unlocked">Unlocked only</option>
        </select>
      </div>

      {/* pagination bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.3em] text-slate-500">
        <span>Showing {startIndex}-{endIndex} of {totalCount}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="adminPageSize" className="text-[10px] text-slate-400">Rows</label>
          <select id="adminPageSize" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-600" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-600 disabled:opacity-50" onClick={() => setPage((c) => Math.max(1, c - 1))} disabled={page === 1}>Prev</button>
            <span className="text-[10px] text-slate-400">Page {page} of {totalPages}</span>
            <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-600 disabled:opacity-50" onClick={() => setPage((c) => Math.min(totalPages, c + 1))} disabled={page >= totalPages}>Next</button>
          </div>
        </div>
      </div>

      {/* messages */}
      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {successMsg && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMsg}</p>
      )}

      {/* table */}
      {loading ? (
        <div className="mt-8 flex items-center justify-center py-16">
          <p className="text-sm text-slate-500">Loading threads...</p>
        </div>
      ) : threads.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {totalThreads === 0 ? "No forum threads found." : "No threads match your filter."}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Thread</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((thread) => (
                <Fragment key={thread.id}>
                  <tr
                    className={`border-b border-slate-100 transition hover:bg-slate-50/70 ${thread.is_locked ? "bg-amber-50/30" : ""}`}
                  >
                    <td className="max-w-[260px] px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleExpand(thread.id)}
                        className="flex items-center gap-2 text-left font-medium text-slate-900 transition hover:text-sky-700"
                      >
                        <IconChevron className="h-3.5 w-3.5 shrink-0" direction={expandedId === thread.id ? "down" : "right"} />
                        <span className="truncate">{thread.title}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      <p className="font-medium">{thread.authorName}</p>
                      {thread.authorOrg && (
                        <p className="text-[11px] text-slate-400">{thread.authorOrg}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(thread.categories || []).map((c) => (
                          <span key={c.id} className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                            {c.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {thread.is_locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-700">
                          <IconLock className="h-3 w-3" /> Locked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-700">
                          <IconUnlock className="h-3 w-3" /> Open
                        </span>
                      )}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-xs text-slate-500">
                      {thread.is_locked ? (thread.lock_reason || "Thread locked") : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {formatRelativeTime(thread.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {thread.is_locked ? (
                          <button
                            type="button"
                            disabled={busyId === thread.id}
                            onClick={() => toggleLock(thread)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <IconUnlock className="h-3.5 w-3.5" />
                            {busyId === thread.id ? "..." : "Unlock"}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busyId === thread.id}
                              onClick={() => toggleLock(thread)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                              title='Lock with default "Thread locked" reason'
                            >
                              <IconLock className="h-3.5 w-3.5" />
                              {busyId === thread.id ? "..." : "Lock"}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === thread.id}
                              onClick={() => { setLockModalThread(thread); setLockReason(""); }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                              title="Lock with a custom reason"
                            >
                              Lock + Reason
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteModalThread(thread)}
                          disabled={!!deletingId}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                          title="Delete thread"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === thread.id && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="space-y-4">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Thread Body</p>
                            {thread.body ? (
                              <p className="whitespace-pre-wrap text-sm text-slate-700">{thread.body}</p>
                            ) : (
                              <p className="text-sm italic text-slate-400">No body content</p>
                            )}
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                              Replies {loadingPosts ? "" : `(${expandedPosts.length})`}
                            </p>
                            {loadingPosts ? (
                              <p className="text-xs text-slate-400">Loading replies...</p>
                            ) : expandedPosts.length === 0 ? (
                              <p className="text-xs italic text-slate-400">No replies yet.</p>
                            ) : (
                              <div className="max-h-80 space-y-2 overflow-y-auto">
                                {expandedPosts.map((post) => (
                                  <div key={post.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs text-slate-400">
                                        <span className="font-medium text-slate-600">{post.authorName}</span>{" · "}{formatRelativeTime(post.created_at)}
                                      </p>
                                      <p className="mt-1 break-words whitespace-pre-wrap text-sm text-slate-700">{post.body}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => deletePost(post.id)}
                                      disabled={deletingId === post.id}
                                      className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                                      title="Delete reply"
                                    >
                                      <IconTrash className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* lock reason modal */}
      {lockModalThread && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Lock Thread</h2>
            <p className="mt-1 text-sm text-slate-500 truncate">
              {lockModalThread.title}
            </p>
            <label className="mt-4 block text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Reason (visible to users)
            </label>
            <textarea
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="e.g. Off-topic discussion, resolved, etc."
              rows={3}
              className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300"
            />
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => { setLockModalThread(null); setLockReason(""); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLockWithReason}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-amber-600"
              >
                Lock Thread
              </button>
            </div>
          </div>
        </div>
      )}

      {/* delete confirmation modal */}
      {deleteModalThread && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Delete Thread</h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {deleteModalThread.title}
            </p>
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              This will permanently delete the thread, all its replies, and associated likes. This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteModalThread(null)}
                disabled={!!deletingId}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteThread(deleteModalThread)}
                disabled={!!deletingId}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deletingId ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
