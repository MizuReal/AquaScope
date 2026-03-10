import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ADMIN_ROLE_VALUE } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

const configMissing = !supabase || !isSupabaseConfigured;
const missingRelationCode = "42P01";
const missingSchemaCode = "3F000";
const permissionDeniedCode = "42501";
const snapshotTimeoutMs = 15000;
const enableAdminDebugLogs = import.meta.env.VITE_ADMIN_DEBUG_LOGS === "true";

const FIELD_SAMPLES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";
const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";
const SUPABASE_AVATAR_BUCKET = import.meta.env.VITE_PUBLIC_SUPABASE_AVATAR_BUCKET || "avatars";
const CONTAINER_SAMPLE_CANDIDATES = [
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE,
  import.meta.env.VITE_PUBLIC_CONTAINER_SAMPLES_TABLE,
  "container_scans",
  "container_samples",
].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);

function isMissingRelation(error) {
  return error?.code === missingRelationCode || error?.code === missingSchemaCode;
}

function isPermissionDenied(error) {
  return error?.code === permissionDeniedCode;
}

function adminDebugLog(event, payload = {}) {
  if (!enableAdminDebugLogs) {
    return;
  }

  const now = new Date().toISOString();
  console.info(`[AdminDashboard] ${event}`, {
    at: now,
    ...payload,
  });
}

async function runTimedStep({ requestId, step, task }) {
  const startedAt = Date.now();

  try {
    const result = await task();
    adminDebugLog("snapshot:step-success", {
      requestId,
      step,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    adminDebugLog("snapshot:step-error", {
      requestId,
      step,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Unknown error",
      code: error?.code || null,
    });
    throw error;
  }
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function countRows(table, filterFn) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (typeof filterFn === "function") {
    query = filterFn(query);
  }

  const { count, error } = await query;
  return { count: count || 0, error };
}

async function getLatestCreatedAt(table) {
  const { data, error } = await supabase
    .from(table)
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  return { value: data?.[0]?.created_at || null, error };
}

async function resolveContainerTable() {
  for (const table of CONTAINER_SAMPLE_CANDIDATES) {
    const result = await countRows(table);
    if (!result.error) {
      return { table, count: result.count, error: null };
    }

    if (isMissingRelation(result.error)) {
      continue;
    }

    return { table, count: 0, error: result.error };
  }

  return {
    table: null,
    count: 0,
    error: {
      code: missingRelationCode,
      message: `No container sample table found. Tried: ${CONTAINER_SAMPLE_CANDIDATES.join(", ")}.`,
    },
  };
}

function formatDateTime(value) {
  if (!value) return "No data yet";
  return new Date(value).toLocaleString();
}

function pickAdminName(sessionUser, profile) {
  const userMetadata = sessionUser?.user_metadata || {};
  return (
    profile?.display_name ||
    userMetadata.display_name ||
    userMetadata.full_name ||
    userMetadata.name ||
    sessionUser?.email?.split("@")[0] ||
    "Admin"
  );
}

async function resolveAvatarUrl(rawValue) {
  if (!rawValue) return "";
  if (/^https?:\/\//i.test(rawValue)) return rawValue;

  const marker = `/${SUPABASE_AVATAR_BUCKET}/`;
  const path = rawValue.includes(marker) ? rawValue.slice(rawValue.indexOf(marker) + marker.length) : rawValue;

  try {
    const { data } = supabase.storage.from(SUPABASE_AVATAR_BUCKET).getPublicUrl(path);
    return data?.publicUrl || "";
  } catch {
    return "";
  }
}

function StatIcon({ icon }) {
  const commonProps = {
    xmlns: "http://www.w3.org/2000/svg",
    className: "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  if (icon === "users") {
    return (
      <svg {...commonProps}>
        <circle cx="8" cy="9" r="2" />
        <circle cx="16" cy="9" r="2" />
        <path d="M4.5 18a3.5 3.5 0 0 1 7 0" />
        <path d="M12.5 18a3.5 3.5 0 0 1 7 0" />
      </svg>
    );
  }

  if (icon === "shield") {
    return (
      <svg {...commonProps}>
        <path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z" />
      </svg>
    );
  }

  if (icon === "beaker") {
    return (
      <svg {...commonProps}>
        <path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-9V3" />
        <path d="M8.5 13h7" />
      </svg>
    );
  }

  if (icon === "forum") {
    return (
      <svg {...commonProps}>
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }

  if (icon === "heartbeat") {
    return (
      <svg {...commonProps}>
        <path d="M3 12h4l2-4 4 8 2-4h6" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="6" y="11" width="3" height="7" rx="0.8" />
      <rect x="11" y="8" width="3" height="10" rx="0.8" />
      <rect x="16" y="5" width="3" height="13" rx="0.8" />
    </svg>
  );
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [warningNote, setWarningNote] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("Admin");
  const [adminAvatarUrl, setAdminAvatarUrl] = useState("");
  const [resolvedTables, setResolvedTables] = useState({
    field: FIELD_SAMPLES_TABLE,
    container: CONTAINER_SAMPLE_CANDIDATES[0] || "container_scans",
  });
  const refreshTimerRef = useRef(null);
  const latestSnapshotRequestIdRef = useRef(0);
  const snapshotInFlightRef = useRef(false);
  const queuedSnapshotOptionsRef = useRef(null);
  const [snapshot, setSnapshot] = useState({
    totalUsers: 0,
    activeUsers: 0,
    fieldSamples: 0,
    containerSamples: 0,
    forumThreads: 0,
    latestFieldSampleAt: null,
    latestContainerSampleAt: null,
    updatedAt: null,
  });

  useEffect(() => {
    if (configMissing) {
      return;
    }

    let isMounted = true;

    const loadAdminIdentity = async () => {
      try {
        if (!user?.id) return;

        const { data: profile } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("display_name, avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!isMounted) {
          return;
        }

        const resolvedName = pickAdminName(user, profile);
        const metadataAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
        const rawAvatar = profile?.avatar_url || metadataAvatar || "";
        const resolvedAvatar = await resolveAvatarUrl(rawAvatar);

        if (!isMounted) {
          return;
        }

        setAdminDisplayName(resolvedName);
        setAdminAvatarUrl(resolvedAvatar || rawAvatar || "");
      } catch {
      }
    };

    loadAdminIdentity();

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadSnapshot = useCallback(async ({ silent = false } = {}) => {
    if (configMissing) {
      setLoading(false);
      return;
    }

    if (snapshotInFlightRef.current) {
      const previous = queuedSnapshotOptionsRef.current;
      queuedSnapshotOptionsRef.current = {
        silent: (previous?.silent ?? true) && silent,
      };
      adminDebugLog("snapshot:queued", {
        silent,
        queuedSilent: queuedSnapshotOptionsRef.current.silent,
      });
      return;
    }

    snapshotInFlightRef.current = true;

    const requestId = latestSnapshotRequestIdRef.current + 1;
    latestSnapshotRequestIdRef.current = requestId;
    const snapshotStartedAt = Date.now();

    if (!silent) {
      setLoading(true);
    }

    setFetchError("");
    setWarningNote("");

    try {
      const isCurrentRequest = () => latestSnapshotRequestIdRef.current === requestId;
      adminDebugLog("snapshot:start", {
        requestId,
        silent,
        fieldTable: FIELD_SAMPLES_TABLE,
        containerCandidates: CONTAINER_SAMPLE_CANDIDATES,
      });

      const [
        totalUsersRes,
        activeUsersRes,
        fieldSamplesRes,
        latestFieldRes,
        forumThreadsRes,
        containerResolved,
      ] = await withTimeout(
        Promise.all([
          runTimedStep({
            requestId,
            step: "profiles-total-count",
            task: () =>
              withTimeout(
                countRows(SUPABASE_PROFILES_TABLE),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: profiles-total-count.",
              ),
          }),
          runTimedStep({
            requestId,
            step: "profiles-active-count",
            task: () =>
              withTimeout(
                countRows(SUPABASE_PROFILES_TABLE, (query) => query.eq("status", "active")),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: profiles-active-count.",
              ),
          }),
          runTimedStep({
            requestId,
            step: "field-samples-count",
            task: () =>
              withTimeout(
                countRows(FIELD_SAMPLES_TABLE),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: field-samples-count.",
              ),
          }),
          runTimedStep({
            requestId,
            step: "field-latest-created-at",
            task: () =>
              withTimeout(
                getLatestCreatedAt(FIELD_SAMPLES_TABLE),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: field-latest-created-at.",
              ),
          }),
          runTimedStep({
            requestId,
            step: "forum-threads-count",
            task: () =>
              withTimeout(
                countRows("forum_threads"),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: forum-threads-count.",
              ),
          }),
          runTimedStep({
            requestId,
            step: "resolve-container-table",
            task: () =>
              withTimeout(
                resolveContainerTable(),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: resolve-container-table.",
              ),
          }),
        ]),
        snapshotTimeoutMs + 1000,
        "Admin snapshot request timed out. Please retry.",
      );

      adminDebugLog("snapshot:parallel-complete", {
        requestId,
        elapsedMs: Date.now() - snapshotStartedAt,
        containerTable: containerResolved.table,
        containerCount: containerResolved.count,
      });

      if (!isCurrentRequest()) {
        adminDebugLog("snapshot:stale-after-parallel", {
          requestId,
          activeRequestId: latestSnapshotRequestIdRef.current,
        });
        return;
      }

      const latestContainerRes = containerResolved.table
        ? await runTimedStep({
            requestId,
            step: "container-latest-created-at",
            task: () =>
              withTimeout(
                getLatestCreatedAt(containerResolved.table),
                snapshotTimeoutMs,
                "Admin snapshot step timed out: container-latest-created-at.",
              ),
          })
        : { value: null, error: containerResolved.error };

      adminDebugLog("snapshot:container-latest-complete", {
        requestId,
        elapsedMs: Date.now() - snapshotStartedAt,
        hasLatestContainerError: Boolean(latestContainerRes.error),
      });

      if (!isCurrentRequest()) {
        adminDebugLog("snapshot:stale-after-container-latest", {
          requestId,
          activeRequestId: latestSnapshotRequestIdRef.current,
        });
        return;
      }

      const hardErrors = [
        totalUsersRes,
        activeUsersRes,
        fieldSamplesRes,
        latestFieldRes,
        forumThreadsRes,
      ]
        .map((result) => result.error)
        .filter(Boolean);

      if (containerResolved.error && !isMissingRelation(containerResolved.error)) {
        hardErrors.push(containerResolved.error);
      }

      if (latestContainerRes.error && !isMissingRelation(latestContainerRes.error)) {
        hardErrors.push(latestContainerRes.error);
      }

      const permissionIssue = hardErrors.find((error) => isPermissionDenied(error));
      if (permissionIssue) {
        throw new Error(
          permissionIssue.message ||
            "Access denied while reading admin metrics. Add admin-select RLS policies for the affected tables.",
        );
      }

      const fatalError = hardErrors[0];
      if (fatalError) {
        throw new Error(fatalError.message || "Unable to load system snapshot.");
      }

      if (!containerResolved.table) {
        setWarningNote(
          `Container metrics are unavailable because no table was found. Tried: ${CONTAINER_SAMPLE_CANDIDATES.join(", ")}.`,
        );
      }

      setResolvedTables((prev) => ({
        field: FIELD_SAMPLES_TABLE,
        container: containerResolved.table || prev.container,
      }));

      setSnapshot({
        totalUsers: totalUsersRes.count || 0,
        activeUsers: activeUsersRes.count || 0,
        fieldSamples: fieldSamplesRes.count || 0,
        containerSamples: containerResolved.count || 0,
        forumThreads: forumThreadsRes.count || 0,
        latestFieldSampleAt: latestFieldRes.value || null,
        latestContainerSampleAt: latestContainerRes.value || null,
        updatedAt: new Date().toISOString(),
      });

      adminDebugLog("snapshot:success", {
        requestId,
        elapsedMs: Date.now() - snapshotStartedAt,
        totals: {
          users: totalUsersRes.count || 0,
          activeUsers: activeUsersRes.count || 0,
          fieldSamples: fieldSamplesRes.count || 0,
          containerSamples: containerResolved.count || 0,
          forumThreads: forumThreadsRes.count || 0,
        },
      });
    } catch (error) {
      adminDebugLog("snapshot:error", {
        requestId,
        elapsedMs: Date.now() - snapshotStartedAt,
        message: error?.message || "Unknown error",
        code: error?.code || null,
        isTimeout: /timed out/i.test(error?.message || ""),
      });

      if (latestSnapshotRequestIdRef.current === requestId) {
        setFetchError(error?.message || "Unable to load system snapshot.");
      }
    } finally {
      snapshotInFlightRef.current = false;

      // A non-silent request sets loading=true when it starts, so it must
      // always clear it when it finishes — even if a newer silent request has
      // since incremented latestSnapshotRequestIdRef. Omitting the check here
      // was the original cause of the dashboard getting stuck on "Loading…".
      if (!silent) {
        setLoading(false);
      }

      adminDebugLog("snapshot:finally", {
        requestId,
        elapsedMs: Date.now() - snapshotStartedAt,
        isCurrent: latestSnapshotRequestIdRef.current === requestId,
      });

      const queued = queuedSnapshotOptionsRef.current;
      if (queued) {
        queuedSnapshotOptionsRef.current = null;
        adminDebugLog("snapshot:run-queued", {
          requestId,
          queuedSilent: queued.silent,
        });
        loadSnapshot(queued);
      }
    }
  }, []);

  useEffect(() => {
    if (configMissing) {
      setLoading(false);
      return;
    }

    loadSnapshot();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        loadSnapshot({ silent: true });
      }, 250);
    };

    const channel = supabase
      .channel("admin-dashboard-overview")
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_PROFILES_TABLE }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: FIELD_SAMPLES_TABLE }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "container_scans" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "container_samples" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_threads" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_posts" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_post_likes" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [loadSnapshot]);

  const totalSamples = snapshot.fieldSamples + snapshot.containerSamples;
  const activeRate = snapshot.totalUsers > 0 ? Math.round((snapshot.activeUsers / snapshot.totalUsers) * 100) : 0;

  const kpiCards = useMemo(
    () => [
      {
        label: "Total system users",
        value: snapshot.totalUsers,
        detail: `${snapshot.activeUsers} currently active`,
        icon: "users",
        style: {
          cardBorder: "border-sky-300",
          iconWrap: "border-sky-300 bg-sky-100 text-sky-700",
        },
      },
      {
        label: "Total active user ratio",
        value: `${activeRate}%`,
        detail: "Active user ratio",
        icon: "shield",
        style: {
          cardBorder: "border-emerald-300",
          iconWrap: "border-emerald-300 bg-emerald-100 text-emerald-700",
        },
      },
      {
        label: "Total field samples",
        value: snapshot.fieldSamples,
        detail: "Collected across the system",
        icon: "beaker",
        style: {
          cardBorder: "border-violet-300",
          iconWrap: "border-violet-300 bg-violet-100 text-violet-700",
        },
      },
      {
        label: "Total container scans",
        value: snapshot.containerSamples,
        detail: "Container scan records",
        icon: "heartbeat",
        style: {
          cardBorder: "border-amber-300",
          iconWrap: "border-amber-300 bg-amber-100 text-amber-700",
        },
      },
      {
        label: "Total forum threads",
        value: snapshot.forumThreads,
        detail: "Community forum threads",
        icon: "forum",
        style: {
          cardBorder: "border-fuchsia-300",
          iconWrap: "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-700",
        },
      },
    ],
    [activeRate, snapshot],
  );

  const healthItems = [
    {
      label: "Authentication & roles",
      status: configMissing ? "Config required" : "Operational",
      tone: configMissing ? "warning" : "healthy",
      note: configMissing
        ? "Missing Supabase environment configuration."
        : "Admin access control is active through profile roles.",
    },
    {
      label: "Data ingestion",
      status: totalSamples > 0 ? "Receiving" : "Idle",
      tone: totalSamples > 0 ? "healthy" : "warning",
      note: `Latest field sample: ${formatDateTime(snapshot.latestFieldSampleAt)}`,
    },
    {
      label: "Community activity",
      status: snapshot.forumThreads > 0 ? "Active" : "Low",
      tone: snapshot.forumThreads > 0 ? "healthy" : "warning",
      note: `Latest container sample: ${formatDateTime(snapshot.latestContainerSampleAt)}`,
    },
  ];

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Admin Dashboard</p>
          <h1 className="text-3xl font-semibold text-slate-900">System Snapshot</h1>
          <p className="mt-2 text-sm text-slate-500">Wide-scope platform state with concise operational signals.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-600">
              {adminAvatarUrl ? (
                <img src={adminAvatarUrl} alt={adminDisplayName} className="h-full w-full object-cover" />
              ) : (
                String(adminDisplayName || "A").charAt(0).toUpperCase()
              )}
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Welcome back</p>
              <p className="text-sm font-semibold text-slate-800">{adminDisplayName}</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm text-slate-700">
            {loading ? "Refreshing metrics..." : `Updated: ${formatDateTime(snapshot.updatedAt)}`}
          </span>
        </div>
      </header>

      {configMissing ? (
        <p className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Supabase is not configured. Add VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY in .env.local.
        </p>
      ) : null}

      {fetchError ? (
        <p className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      ) : null}

      {warningNote ? (
        <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{warningNote}</p>
      ) : null}

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {kpiCards.map((card) => (
          <article
            key={card.label}
            className={`space-y-4 rounded-2xl border-2 bg-white p-7 shadow-sm ${card.style.cardBorder}`}
          >
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${card.style.iconWrap}`}>
                <StatIcon icon={card.icon} />
              </span>
              <p className="text-xs font-medium uppercase tracking-[0.35em] text-slate-400">{card.label}</p>
            </div>
            <p className="text-3xl font-bold text-slate-900">{loading ? "—" : card.value}</p>
            <p className="text-xs leading-relaxed text-slate-500">{card.detail}</p>
          </article>
        ))}
      </div>

      <article className="mt-8 rounded-2xl border-2 border-sky-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.35em] text-sky-600">Operational health</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {healthItems.map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">{item.label}</p>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${
                    item.tone === "healthy"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">{item.note}</p>
            </div>
          ))}
        </div>
      </article>


    </section>
  );
}
