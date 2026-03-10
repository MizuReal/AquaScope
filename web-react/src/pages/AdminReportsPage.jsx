import { useCallback, useEffect, useRef, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const configMissing = !supabase || !isSupabaseConfigured;
const SUPABASE_PROFILES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";

/* ── tiny SVG icons ── */

const IconFlag = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
);
const IconCheck = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IconX = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IconEye = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
);
const IconLock = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
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

const STATUS_STYLES = {
  pending: "border-amber-300 bg-amber-50 text-amber-700",
  reviewed: "border-emerald-300 bg-emerald-50 text-emerald-700",
  dismissed: "border-slate-300 bg-slate-100 text-slate-500",
};

export default function AdminReportsPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [filter, setFilter] = useState("pending");
  const [successMsg, setSuccessMsg] = useState("");
  const successTimer = useRef(null);

  /* stats */
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);

  /* detail modal */
  const [detailReport, setDetailReport] = useState(null);
  const [detailThread, setDetailThread] = useState(null);
  const [detailPosts, setDetailPosts] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const flash = (msg) => {
    setSuccessMsg(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccessMsg(""), 3500);
  };

  /* ── load reports ── */
  const loadReports = useCallback(async () => {
    if (configMissing) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      let query = supabase
        .from("forum_reports")
        .select("id, reporter_id, thread_id, reason, status, reviewed_by, reviewed_at, created_at")
        .order("created_at", { ascending: false });

      if (filter !== "all") query = query.eq("status", filter);

      const { data, error: err } = await query;
      if (err) throw err;

      const rows = data || [];

      /* resolve reporter + reviewer profiles */
      const userIds = [
        ...new Set([
          ...rows.map((r) => r.reporter_id),
          ...rows.map((r) => r.reviewed_by),
        ].filter(Boolean)),
      ];
      let profileMap = new Map();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("id, display_name")
          .in("id", userIds);
        (profiles || []).forEach((p) => profileMap.set(p.id, p));
      }

      /* resolve thread titles */
      const threadIds = [...new Set(rows.map((r) => r.thread_id).filter(Boolean))];
      let threadMap = new Map();
      if (threadIds.length) {
        const { data: threads } = await supabase
          .from("forum_threads")
          .select("id, title, is_locked")
          .in("id", threadIds);
        (threads || []).forEach((t) => threadMap.set(t.id, t));
      }

      setReports(
        rows.map((r) => ({
          ...r,
          reporterName: profileMap.get(r.reporter_id)?.display_name || "Unknown",
          reviewerName: r.reviewed_by ? (profileMap.get(r.reviewed_by)?.display_name || "Unknown") : null,
          threadTitle: threadMap.get(r.thread_id)?.title || "[Deleted thread]",
          threadLocked: threadMap.get(r.thread_id)?.is_locked || false,
          threadExists: threadMap.has(r.thread_id),
        })),
      );
    } catch (e) {
      setError(e?.message || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  /* ── load stats ── */
  const loadStats = useCallback(async () => {
    if (configMissing) return;
    try {
      const [pRes, rRes, dRes] = await Promise.all([
        supabase.from("forum_reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("forum_reports").select("id", { count: "exact", head: true }).eq("status", "reviewed"),
        supabase.from("forum_reports").select("id", { count: "exact", head: true }).eq("status", "dismissed"),
      ]);
      setPendingCount(Number.isFinite(pRes.count) ? pRes.count : 0);
      setReviewedCount(Number.isFinite(rRes.count) ? rRes.count : 0);
      setDismissedCount(Number.isFinite(dRes.count) ? dRes.count : 0);
    } catch (_) { /* non-critical */ }
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);
  useEffect(() => { loadStats(); }, [loadStats]);

  /* ── realtime refresh ── */
  useEffect(() => {
    if (configMissing) return;
    const channel = supabase
      .channel("admin-forum-reports")
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_reports" }, () => {
        loadReports();
        loadStats();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadReports, loadStats]);

  /* ── update report status ── */
  const updateStatus = async (report, newStatus) => {
    if (busyId) return;
    setBusyId(report.id);
    setError("");
    try {
      const { error: err } = await supabase
        .from("forum_reports")
        .update({
          status: newStatus,
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", report.id);
      if (err) throw err;
      setReports((prev) =>
        prev.map((r) =>
          r.id === report.id
            ? { ...r, status: newStatus, reviewed_by: user?.id, reviewerName: "You", reviewed_at: new Date().toISOString() }
            : r,
        ),
      );
      loadStats();
      flash(`Report marked as ${newStatus}.`);
    } catch (e) {
      setError(e?.message || "Failed to update report.");
    } finally {
      setBusyId("");
    }
  };

  /* ── lock the reported thread ── */
  const lockThread = async (report) => {
    if (busyId) return;
    setBusyId(report.id);
    setError("");
    try {
      const { error: err } = await supabase
        .from("forum_threads")
        .update({ is_locked: true, lock_reason: "Locked due to community report" })
        .eq("id", report.thread_id);
      if (err) throw err;
      // Also mark the report as reviewed
      await supabase
        .from("forum_reports")
        .update({ status: "reviewed", reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
        .eq("id", report.id);
      setReports((prev) =>
        prev.map((r) =>
          r.id === report.id
            ? { ...r, status: "reviewed", threadLocked: true, reviewed_by: user?.id, reviewerName: "You", reviewed_at: new Date().toISOString() }
            : r,
        ),
      );
      loadStats();
      flash(`Thread locked and report reviewed.`);
    } catch (e) {
      setError(e?.message || "Failed to lock thread.");
    } finally {
      setBusyId("");
    }
  };

  /* ── delete the reported thread ── */
  const deleteThread = async (report) => {
    if (busyId) return;
    setBusyId(report.id);
    setError("");
    try {
      // Cascade: post likes → posts → thread likes → thread categories → reports referencing thread → thread
      const { data: posts } = await supabase.from("forum_posts").select("id").eq("thread_id", report.thread_id);
      const postIds = (posts || []).map((p) => p.id);
      if (postIds.length) {
        await supabase.from("forum_post_likes").delete().in("post_id", postIds);
      }
      await supabase.from("forum_posts").delete().eq("thread_id", report.thread_id);
      await supabase.from("forum_thread_likes").delete().eq("thread_id", report.thread_id);
      await supabase.from("forum_thread_categories").delete().eq("thread_id", report.thread_id);
      // Mark all reports for this thread as reviewed before deleting the thread
      await supabase
        .from("forum_reports")
        .update({ status: "reviewed", reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
        .eq("thread_id", report.thread_id);
      const { error: err } = await supabase.from("forum_threads").delete().eq("id", report.thread_id);
      if (err) throw err;
      setReports((prev) => prev.filter((r) => r.thread_id !== report.thread_id));
      loadStats();
      flash(`Thread deleted and all related reports resolved.`);
    } catch (e) {
      setError(e?.message || "Failed to delete thread.");
    } finally {
      setBusyId("");
    }
  };

  /* ── view thread detail in modal ── */
  const openDetail = async (report) => {
    setDetailReport(report);
    setDetailThread(null);
    setDetailPosts([]);
    setDetailLoading(true);
    try {
      const { data: thread } = await supabase
        .from("forum_threads")
        .select("id, user_id, title, body, is_locked, lock_reason, created_at")
        .eq("id", report.thread_id)
        .single();
      if (!thread) { setDetailLoading(false); return; }

      let authorName = "Unknown";
      if (thread.user_id) {
        const { data: profile } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("display_name")
          .eq("id", thread.user_id)
          .single();
        if (profile?.display_name) authorName = profile.display_name;
      }
      setDetailThread({ ...thread, authorName });

      const { data: posts } = await supabase
        .from("forum_posts")
        .select("id, user_id, body, created_at")
        .eq("thread_id", report.thread_id)
        .order("created_at", { ascending: true })
        .limit(50);

      const postUserIds = [...new Set((posts || []).map((p) => p.user_id).filter(Boolean))];
      let pMap = new Map();
      if (postUserIds.length) {
        const { data: profiles } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("id, display_name")
          .in("id", postUserIds);
        (profiles || []).forEach((p) => pMap.set(p.id, p));
      }
      setDetailPosts((posts || []).map((p) => ({ ...p, authorName: pMap.get(p.user_id)?.display_name || "Unknown" })));
    } catch {
      /* non-critical */
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header>
        <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Admin Panel</p>
        <h1 className="text-3xl font-semibold text-slate-900">Reported Threads</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review community reports. Take action by dismissing, locking, or deleting threads.
        </p>
      </header>

      {/* stats bar */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Pending: <strong>{pendingCount}</strong>
        </span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Reviewed: <strong>{reviewedCount}</strong>
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Dismissed: <strong>{dismissedCount}</strong>
        </span>
      </div>

      {/* filter toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-300"
        >
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All reports</option>
        </select>
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
          <p className="text-sm text-slate-500">Loading reports...</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {filter === "pending" ? "No pending reports. All clear!" : "No reports match this filter."}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Thread</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Reported by</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.id}
                  className={`border-b border-slate-100 transition hover:bg-slate-50/70 ${report.status === "pending" ? "bg-amber-50/20" : ""}`}
                >
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate font-medium text-slate-900">{report.threadTitle}</p>
                    {report.threadLocked && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-600">
                        <IconLock className="h-3 w-3" /> Locked
                      </span>
                    )}
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-sm text-slate-600">
                    <p className="line-clamp-2">{report.reason}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {report.reporterName}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ${STATUS_STYLES[report.status] || STATUS_STYLES.pending}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {formatRelativeTime(report.created_at)}
                    {report.reviewerName && (
                      <p className="mt-0.5 text-[10px] text-slate-400">by {report.reviewerName}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {report.threadExists && (
                        <button
                          type="button"
                          onClick={() => openDetail(report)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                          title="View thread content"
                        >
                          <IconEye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {report.status === "pending" && (
                        <>
                          <button
                            type="button"
                            disabled={!!busyId}
                            onClick={() => updateStatus(report, "dismissed")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                            title="Dismiss report"
                          >
                            <IconX className="h-3.5 w-3.5" />
                            {busyId === report.id ? "..." : "Dismiss"}
                          </button>
                          {report.threadExists && !report.threadLocked && (
                            <button
                              type="button"
                              disabled={!!busyId}
                              onClick={() => lockThread(report)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                              title="Lock thread and mark reviewed"
                            >
                              <IconLock className="h-3.5 w-3.5" />
                              {busyId === report.id ? "..." : "Lock"}
                            </button>
                          )}
                          {report.threadExists && (
                            <button
                              type="button"
                              disabled={!!busyId}
                              onClick={() => deleteThread(report)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                              title="Delete thread permanently"
                            >
                              <IconTrash className="h-3.5 w-3.5" />
                              {busyId === report.id ? "..." : "Delete"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!!busyId}
                            onClick={() => updateStatus(report, "reviewed")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                            title="Mark as reviewed"
                          >
                            <IconCheck className="h-3.5 w-3.5" />
                            {busyId === report.id ? "..." : "Reviewed"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* thread detail modal */}
      {detailReport && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Reported Thread</h2>
              <button
                type="button"
                onClick={() => { setDetailReport(null); setDetailThread(null); setDetailPosts([]); }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-600">Report reason</p>
              <p className="mt-1 text-amber-800">{detailReport.reason}</p>
              <p className="mt-1 text-xs text-amber-600">Reported by {detailReport.reporterName} · {formatRelativeTime(detailReport.created_at)}</p>
            </div>

            {detailLoading ? (
              <p className="mt-4 text-sm text-slate-500">Loading thread...</p>
            ) : detailThread ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">{detailThread.authorName}</p>
                    <span className="text-xs text-slate-500">{formatRelativeTime(detailThread.created_at)}</span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-slate-900">{detailThread.title}</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{detailThread.body}</p>
                </div>

                {detailPosts.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Replies ({detailPosts.length})
                    </p>
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {detailPosts.map((post) => (
                        <div key={post.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <p className="text-xs text-slate-400">
                            <span className="font-medium text-slate-600">{post.authorName}</span>{" · "}{formatRelativeTime(post.created_at)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{post.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Thread not found — it may have been deleted.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
