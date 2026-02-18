"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const WATER_SAMPLES_TABLE = process.env.NEXT_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";
const CONTAINER_SAMPLES_TABLE = process.env.NEXT_PUBLIC_CONTAINER_SAMPLES_TABLE || "container_samples";

const configMissing = !supabase || !isSupabaseConfigured;

const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}%`;
};

const average = (values = []) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values = []) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const compactDateLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "--";
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const compactTimeLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "--";
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
};

const riskToScore = (risk = "") => {
  const normalized = String(risk || "").toLowerCase();
  if (normalized === "safe") return 0.15;
  if (normalized === "borderline") return 0.35;
  if (normalized === "watch") return 0.65;
  if (normalized === "unsafe") return 0.88;
  return 0.5;
};

const riskToStatus = (risk = "") => {
  const normalized = String(risk || "").toLowerCase();
  if (normalized === "safe" || normalized === "borderline") return "Cleared";
  if (normalized === "watch") return "Review";
  if (normalized === "unsafe") return "Alert";
  return "Review";
};

const describePh = (value) => {
  if (!Number.isFinite(value)) return "No data";
  if (value < 6.5) return "Acidic";
  if (value > 8.5) return "Alkaline";
  return "Balanced";
};

const describeTurbidity = (value) => {
  if (!Number.isFinite(value)) return "No data";
  if (value <= 1) return "Very clear";
  if (value <= 5) return "Acceptable";
  return "Elevated";
};

const describeConductivity = (value) => {
  if (!Number.isFinite(value)) return "No data";
  if (value < 250) return "Low mineral load";
  if (value <= 600) return "Moderate mineral load";
  return "High mineral load";
};

const describeHardness = (value) => {
  if (!Number.isFinite(value)) return "No data";
  if (value < 60) return "Soft";
  if (value <= 120) return "Moderate";
  if (value <= 180) return "Hard";
  return "Very hard";
};

const buildRecentDayBuckets = (samples, days = 7) => {
  const buckets = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    buckets.push({ key, date, count: 0 });
  }

  samples.forEach((row) => {
    const date = row?.created_at ? new Date(row.created_at) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const bucket = buckets.find((entry) => entry.key === key);
    if (bucket) bucket.count += 1;
  });

  return buckets;
};

const buildSparklinePath = (values, width = 520, height = 180, padding = 12) => {
  if (!values.length) return "";

  const safeValues = values.map((value) => (Number.isFinite(value) ? Number(value) : 0));
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const span = max - min || 1;
  const stepX = safeValues.length > 1 ? (width - padding * 2) / (safeValues.length - 1) : 0;

  return safeValues
    .map((value, index) => {
      const x = padding + index * stepX;
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
};

const formatMetric = (value, digits = 2) => {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits);
};

const statusBarStyle = {
  Cleared: "bg-sky-500",
  Review: "bg-amber-500",
  Alert: "bg-rose-500",
};

const statusBadgeStyle = {
  Cleared: "border-sky-200 bg-sky-50 text-sky-700",
  Review: "border-amber-200 bg-amber-50 text-amber-700",
  Alert: "border-rose-200 bg-rose-50 text-rose-700",
};

export default function AnalyticsPage() {
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [samples, setSamples] = useState([]);

  useEffect(() => {
    if (configMissing) {
      return;
    }

    let isMounted = true;

    const loadAnalytics = async (userId) => {
      setLoading(true);
      setError("");

      const sharedSelect =
        "id, created_at, source, risk_level, prediction_probability, prediction_is_potable, ph, turbidity, conductivity, hardness, solids, chloramines, sulfate, organic_carbon, trihalomethanes, microbial_risk, microbial_score";

      try {
        const [waterResult, containerResult] = await Promise.allSettled([
          supabase
            .from(WATER_SAMPLES_TABLE)
            .select(sharedSelect)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(180),
          supabase
            .from(CONTAINER_SAMPLES_TABLE)
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(120),
        ]);

        const merged = [];

        if (waterResult.status === "fulfilled") {
          if (waterResult.value.error) throw waterResult.value.error;
          merged.push(...(waterResult.value.data || []));
        }

        if (containerResult.status === "fulfilled") {
          if (containerResult.value.error) {
            throw containerResult.value.error;
          }
          merged.push(...(containerResult.value.data || []));
        }

        if (waterResult.status === "rejected" && containerResult.status === "rejected") {
          throw new Error("Unable to load analytics records from your sample tables.");
        }

        merged.sort((a, b) => {
          const timeA = a?.created_at ? new Date(a.created_at).getTime() : 0;
          const timeB = b?.created_at ? new Date(b.created_at).getTime() : 0;
          return timeB - timeA;
        });

        if (isMounted) {
          setSamples(merged);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError?.message || "Unable to load analytics data.");
          setSamples([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const bootstrap = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (sessionError) {
        setAuthError("Unable to verify your session. Please try logging in again.");
        setChecking(false);
        setLoading(false);
        return;
      }

      const userId = data?.session?.user?.id;
      if (!userId) {
        setAuthReady(false);
        setChecking(false);
        setLoading(false);
        return;
      }

      setAuthReady(true);
      setChecking(false);
      await loadAnalytics(userId);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;

      if (!session?.user?.id) {
        setAuthReady(false);
        setSamples([]);
        return;
      }

      setAuthReady(true);
      await loadAnalytics(session.user.id);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const analytics = useMemo(() => {
    const total = samples.length;
    const potableCount = samples.filter((row) => row?.prediction_is_potable === true).length;
    const watchOrUnsafe = samples.filter((row) => {
      const risk = String(row?.risk_level || "").toLowerCase();
      return risk === "watch" || risk === "unsafe";
    }).length;

    const probabilityValues = samples
      .map((row) => numeric(row?.prediction_probability))
      .filter((value) => Number.isFinite(value));

    const avgProbability = average(probabilityValues);
    const medianProbability = median(probabilityValues);

    const recent = [...samples].reverse().slice(-12);

    const confidenceTrend = recent.map((row) => ({
      label: compactTimeLabel(row?.created_at),
      value: Number.isFinite(numeric(row?.prediction_probability)) ? Number(row.prediction_probability) : 0,
    }));

    const riskTrend = recent.map((row) => ({
      label: compactTimeLabel(row?.created_at),
      value: riskToScore(row?.risk_level),
    }));

    const dayBuckets = buildRecentDayBuckets(samples, 7);

    const statusCounts = { Cleared: 0, Review: 0, Alert: 0 };
    samples.forEach((row) => {
      const status = riskToStatus(row?.risk_level);
      statusCounts[status] += 1;
    });

    const statusDistribution = [
      { name: "Cleared", population: statusCounts.Cleared },
      { name: "Review", population: statusCounts.Review },
      { name: "Alert", population: statusCounts.Alert },
    ].filter((item) => item.population > 0);

    const phValues = samples.map((row) => numeric(row?.ph)).filter((value) => Number.isFinite(value));
    const turbidityValues = samples.map((row) => numeric(row?.turbidity)).filter((value) => Number.isFinite(value));
    const conductivityValues = samples.map((row) => numeric(row?.conductivity)).filter((value) => Number.isFinite(value));
    const hardnessValues = samples.map((row) => numeric(row?.hardness)).filter((value) => Number.isFinite(value));

    const parameterCards = [
      {
        key: "ph",
        label: "pH",
        avg: average(phValues),
        median: median(phValues),
        descriptor: describePh(average(phValues)),
      },
      {
        key: "turbidity",
        label: "Turbidity",
        avg: average(turbidityValues),
        median: median(turbidityValues),
        descriptor: describeTurbidity(average(turbidityValues)),
      },
      {
        key: "conductivity",
        label: "Conductivity",
        avg: average(conductivityValues),
        median: median(conductivityValues),
        descriptor: describeConductivity(average(conductivityValues)),
      },
      {
        key: "hardness",
        label: "Hardness",
        avg: average(hardnessValues),
        median: median(hardnessValues),
        descriptor: describeHardness(average(hardnessValues)),
      },
    ];

    const microbialCounts = { low: 0, medium: 0, high: 0, unknown: 0 };
    samples.forEach((row) => {
      const risk = String(row?.microbial_risk || "").toLowerCase();
      if (risk === "low" || risk === "medium" || risk === "high") {
        microbialCounts[risk] += 1;
      } else {
        microbialCounts.unknown += 1;
      }
    });

    const insights = [];
    if (!total) {
      insights.push("No saved samples yet. Submit samples from Data Input to unlock analytics trends.");
    } else {
      insights.push(`You have ${total} saved samples with ${formatPercent(total ? potableCount / total : 0)} potable outcomes.`);
      insights.push(`Watch/unsafe samples count is ${watchOrUnsafe}, useful for targeted follow-up checks.`);
      if (Number.isFinite(avgProbability)) {
        insights.push(`Average model confidence is ${formatPercent(avgProbability)} (median ${formatPercent(medianProbability || 0)}).`);
      }
      const phAvg = average(phValues);
      if (Number.isFinite(phAvg)) {
        insights.push(`pH trend is ${describePh(phAvg).toLowerCase()} with average ${phAvg.toFixed(2)}.`);
      }
      const turbidityAvg = average(turbidityValues);
      if (Number.isFinite(turbidityAvg)) {
        insights.push(`Turbidity is ${describeTurbidity(turbidityAvg).toLowerCase()} at ${turbidityAvg.toFixed(2)} NTU average.`);
      }
    }

    return {
      total,
      potableCount,
      watchOrUnsafe,
      avgProbability,
      confidenceTrend,
      riskTrend,
      dayBuckets,
      statusDistribution,
      parameterCards,
      microbialCounts,
      insights,
    };
  }, [samples]);

  const hasChartData = analytics.total > 0;
  const riskDistTotal = analytics.statusDistribution.reduce((sum, row) => sum + row.population, 0);
  const confidencePath = buildSparklinePath(analytics.confidenceTrend.map((entry) => entry.value));
  const riskPath = buildSparklinePath(analytics.riskTrend.map((entry) => entry.value));
  const maxDaily = Math.max(1, ...analytics.dayBuckets.map((bucket) => bucket.count));

  if (configMissing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900">
        <div className="max-w-md space-y-4">
          <p className="text-xl font-semibold">Configure Supabase auth</p>
          <p className="text-sm text-slate-500">
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to web/.env.local so we can secure the analytics route.
          </p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">
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
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">
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
          <p className="text-sm text-slate-500">Log in to view your analytics.</p>
          <Link className="text-sm uppercase tracking-[0.3em] text-sky-600" href="/">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="flex-1 bg-slate-100 px-6 py-10 lg:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-slate-900">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Analytics</p>
          <h1 className="text-3xl font-semibold text-sky-950">Comprehensive sample intelligence</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            End-to-end analytics across your saved records, including confidence trends, risk distribution, core parameter summaries, microbial profile, and automated insights.
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700">
              Unified records: {analytics.total}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-medium text-emerald-700">
              Potable outcomes: {analytics.potableCount}
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700">
              At-risk samples: {analytics.watchOrUnsafe}
            </span>
          </div>
        </header>

        {loading ? (
          <article className="rounded-2xl border border-sky-200 bg-white p-6 text-sm text-slate-600">Loading analytics...</article>
        ) : (
          <>
            {error ? (
              <article className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</article>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-sky-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-sky-700">Saved samples</p>
                <p className="mt-2 text-3xl font-semibold text-sky-950">{analytics.total}</p>
              </article>
              <article className="rounded-2xl border border-sky-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-sky-700">Potable rate</p>
                <p className="mt-2 text-3xl font-semibold text-sky-900">
                  {formatPercent(analytics.total ? analytics.potableCount / analytics.total : 0)}
                </p>
              </article>
              <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-amber-700">Watch + unsafe</p>
                <p className="mt-2 text-3xl font-semibold text-amber-700">{analytics.watchOrUnsafe}</p>
              </article>
              <article className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-sky-700">Avg confidence</p>
                <p className="mt-2 text-3xl font-semibold text-sky-700">{formatPercent(analytics.avgProbability || 0)}</p>
              </article>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Confidence trend</p>
                <p className="mt-1 text-sm text-slate-500">Latest prediction confidence sequence from recent samples.</p>
                {hasChartData ? (
                  <div className="mt-4 space-y-3">
                    <svg viewBox="0 0 520 180" className="w-full rounded-xl border border-sky-200 bg-sky-50/40 p-2">
                      <path d={confidencePath} fill="none" stroke="#0284c7" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-600 md:grid-cols-4">
                      {analytics.confidenceTrend.map((point) => (
                        <div key={`${point.label}-${point.value}`} className="rounded-lg border border-sky-100 bg-sky-50/60 px-2 py-1.5">
                          <p className="text-[10px] uppercase text-slate-500">{point.label}</p>
                          <p className="font-semibold text-sky-700">{formatPercent(point.value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No chart data yet.</p>
                )}
              </article>

              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Risk index trajectory</p>
                <p className="mt-1 text-sm text-slate-500">Safe → unsafe mapped to a 0.15 → 0.88 risk proxy.</p>
                {hasChartData ? (
                  <div className="mt-4 space-y-3">
                    <svg viewBox="0 0 520 180" className="w-full rounded-xl border border-rose-200 bg-rose-50/50 p-2">
                      <path d={riskPath} fill="none" stroke="#f43f5e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-600 md:grid-cols-4">
                      {analytics.riskTrend.map((point) => (
                        <div key={`${point.label}-${point.value}`} className="rounded-lg border border-rose-100 bg-rose-50/60 px-2 py-1.5">
                          <p className="text-[10px] uppercase text-slate-500">{point.label}</p>
                          <p className="font-semibold text-rose-700">{point.value.toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No risk trend data yet.</p>
                )}
              </article>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <article className="rounded-2xl border border-slate-300 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Daily sample volume (7 days)</p>
                <p className="mt-1 text-sm text-slate-600">Operational throughput from your records.</p>
                <div className="mt-5 flex items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {analytics.dayBuckets.map((bucket) => {
                    const heightPercent = Math.max(8, Math.round((bucket.count / maxDaily) * 100));
                    return (
                      <div key={bucket.key} className="flex flex-1 flex-col items-center gap-2">
                        <p className="text-xs font-semibold text-slate-700">{bucket.count}</p>
                        <div className="flex h-40 w-full items-end rounded-md bg-slate-100 px-1">
                          <div className="w-full rounded-md bg-sky-500" style={{ height: `${heightPercent}%` }} />
                        </div>
                        <p className="text-[11px] text-slate-500">{compactDateLabel(bucket.date)}</p>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Outcome mix</p>
                <p className="mt-1 text-sm text-slate-500">Cleared, review, and alert distribution.</p>
                {riskDistTotal > 0 ? (
                  <div className="mt-4 space-y-3">
                    {analytics.statusDistribution.map((row) => {
                      const ratio = Math.round((row.population / riskDistTotal) * 100);
                      return (
                        <div key={row.name} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className={`rounded-full border px-2 py-0.5 ${statusBadgeStyle[row.name]}`}>
                              {row.name}
                            </span>
                            <span className="font-semibold text-slate-600">
                              {row.population} ({ratio}%)
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full ${statusBarStyle[row.name]}`} style={{ width: `${ratio}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No distribution data yet.</p>
                )}
              </article>
            </div>

            <article className="rounded-2xl border border-sky-200 bg-white p-6">
              <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Parameter intelligence</p>
              <p className="mt-1 text-sm text-slate-500">Aggregated central tendency and interpretation for core model features.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {analytics.parameterCards.map((param) => (
                  <div key={param.key} className="rounded-xl border border-sky-100 bg-sky-50/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-sky-900">{param.label}</p>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        {param.descriptor}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border border-sky-100 bg-white px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Avg</p>
                        <p className="mt-1 font-semibold text-slate-700">{formatMetric(param.avg)}</p>
                      </div>
                      <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-amber-600">Median</p>
                        <p className="mt-1 font-semibold text-amber-700">{formatMetric(param.median)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <div className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Microbial risk snapshot</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                    <p className="text-xs text-slate-500">Low</p>
                    <p className="mt-1 text-2xl font-semibold text-sky-700">{analytics.microbialCounts.low}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-xs text-slate-500">Medium</p>
                    <p className="mt-1 text-2xl font-semibold text-amber-700">{analytics.microbialCounts.medium}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                    <p className="text-xs text-slate-500">High</p>
                    <p className="mt-1 text-2xl font-semibold text-rose-700">{analytics.microbialCounts.high}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Unknown</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-700">{analytics.microbialCounts.unknown}</p>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-emerald-700">Automated insights</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {analytics.insights.map((insight, index) => (
                    <li key={`${insight}-${index}`} className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
                      {insight}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
