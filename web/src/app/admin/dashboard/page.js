"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ADMIN_ROLE_VALUE } from "@/lib/profileRole";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const configMissing = !supabase || !isSupabaseConfigured;

function formatDateTime(value) {
  if (!value) return "No data yet";
  return new Date(value).toLocaleString();
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
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [snapshot, setSnapshot] = useState({
    totalUsers: 0,
    activeUsers: 0,
    adminUsers: 0,
    fieldSamples: 0,
    containerSamples: 0,
    forumThreads: 0,
    forumPosts: 0,
    forumLikes: 0,
    latestFieldSampleAt: null,
    latestContainerSampleAt: null,
    updatedAt: null,
  });

  useEffect(() => {
    if (configMissing) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadSnapshot = async () => {
      setLoading(true);
      setFetchError("");

      try {
        const [
          totalUsersRes,
          activeUsersRes,
          adminUsersRes,
          fieldSamplesRes,
          containerSamplesRes,
          forumThreadsRes,
          forumPostsRes,
          forumLikesRes,
          latestFieldRes,
          latestContainerRes,
        ] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", ADMIN_ROLE_VALUE),
          supabase.from("field_samples").select("id", { count: "exact", head: true }),
          supabase.from("container_samples").select("id", { count: "exact", head: true }),
          supabase.from("forum_threads").select("id", { count: "exact", head: true }),
          supabase.from("forum_posts").select("id", { count: "exact", head: true }),
          supabase.from("forum_post_likes").select("id", { count: "exact", head: true }),
          supabase.from("field_samples").select("created_at").order("created_at", { ascending: false }).limit(1),
          supabase.from("container_samples").select("created_at").order("created_at", { ascending: false }).limit(1),
        ]);

        const failed = [
          totalUsersRes,
          activeUsersRes,
          adminUsersRes,
          fieldSamplesRes,
          containerSamplesRes,
          forumThreadsRes,
          forumPostsRes,
          forumLikesRes,
          latestFieldRes,
          latestContainerRes,
        ].find((result) => result.error);

        if (failed) {
          throw new Error(failed.error.message || "Unable to load system snapshot.");
        }

        if (!isMounted) return;

        setSnapshot({
          totalUsers: totalUsersRes.count || 0,
          activeUsers: activeUsersRes.count || 0,
          adminUsers: adminUsersRes.count || 0,
          fieldSamples: fieldSamplesRes.count || 0,
          containerSamples: containerSamplesRes.count || 0,
          forumThreads: forumThreadsRes.count || 0,
          forumPosts: forumPostsRes.count || 0,
          forumLikes: forumLikesRes.count || 0,
          latestFieldSampleAt: latestFieldRes.data?.[0]?.created_at || null,
          latestContainerSampleAt: latestContainerRes.data?.[0]?.created_at || null,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (!isMounted) return;
        setFetchError(error?.message || "Unable to load system snapshot.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalSamples = snapshot.fieldSamples + snapshot.containerSamples;
  const activeRate = snapshot.totalUsers > 0 ? Math.round((snapshot.activeUsers / snapshot.totalUsers) * 100) : 0;

  const kpiCards = useMemo(
    () => [
      {
        label: "Users",
        value: snapshot.totalUsers,
        detail: `${snapshot.activeUsers} active • ${snapshot.adminUsers} admins`,
        icon: "users",
      },
      {
        label: "Account health",
        value: `${activeRate}%`,
        detail: "Active user ratio",
        icon: "shield",
      },
      {
        label: "Water samples",
        value: totalSamples,
        detail: `${snapshot.fieldSamples} field • ${snapshot.containerSamples} container`,
        icon: "beaker",
      },
      {
        label: "Community",
        value: snapshot.forumThreads,
        detail: `${snapshot.forumPosts} posts • ${snapshot.forumLikes} likes`,
        icon: "forum",
      },
    ],
    [activeRate, snapshot, totalSamples],
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
        <span className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm text-slate-600">
          {loading ? "Refreshing metrics..." : `Updated: ${formatDateTime(snapshot.updatedAt)}`}
        </span>
      </header>

      {configMissing ? (
        <p className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in web/.env.local.
        </p>
      ) : null}

      {fetchError ? (
        <p className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      ) : null}

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <article key={card.label} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-sky-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-200 bg-sky-50">
                <StatIcon icon={card.icon} />
              </span>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">{card.label}</p>
            </div>
            <p className="text-2xl font-semibold text-slate-900">{loading ? "—" : card.value}</p>
            <p className="text-xs leading-relaxed text-slate-500">{card.detail}</p>
          </article>
        ))}
      </div>

      <article className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Operational health</p>
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

      <article className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Admin actions</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Link
            href="/admin/users"
            className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
          >
            Manage users and roles
          </Link>
          <Link
            href="/admin/analytics"
            className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
          >
            Open system analytics
          </Link>
          <Link
            href="/admin/system-settings"
            className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
          >
            Open system settings
          </Link>
        </div>
      </article>

      <article className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Access policy</p>
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Admin authorization follows public.profiles.role where
          <strong className="text-sky-600"> {ADMIN_ROLE_VALUE} = admin</strong>.
          Account status uses public.profiles.status with active/deactivated states.
        </div>
      </article>
    </section>
  );
}
