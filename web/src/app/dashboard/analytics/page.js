"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const WATER_SAMPLES_TABLE = process.env.NEXT_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const configMissing = !supabase || !isSupabaseConfigured;

const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseAnomalyChecks = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

const formatMetric = (value, digits = 2) => {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(digits);
};

const PARAMETER_REFERENCE_META = {
  ph: {
    key: "ph",
    label: "pH",
    unit: "pH",
    referenceType: "range",
    lower: 6.5,
    upper: 8.5,
    color: "#0ea5e9",
  },
  turbidity: {
    key: "turbidity",
    label: "Turbidity",
    unit: "NTU",
    referenceType: "max",
    threshold: 5,
    color: "#14b8a6",
  },
  conductivity: {
    key: "conductivity",
    label: "Conductivity",
    unit: "µS/cm",
    referenceType: "range",
    lower: 250,
    upper: 600,
    color: "#8b5cf6",
  },
  hardness: {
    key: "hardness",
    label: "Hardness",
    unit: "mg/L",
    referenceType: "range",
    lower: 60,
    upper: 180,
    color: "#f59e0b",
  },
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
        "id, created_at, source, risk_level, prediction_probability, prediction_is_potable, ph, turbidity, conductivity, hardness, solids, chloramines, sulfate, organic_carbon, trihalomethanes, microbial_risk, microbial_score, anomaly_checks";

      try {
        const { data, error: queryError } = await supabase
          .from(WATER_SAMPLES_TABLE)
          .select(sharedSelect)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(120);

        if (queryError) {
          throw queryError;
        }

        if (isMounted) {
          setSamples(data || []);
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

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (!session?.user?.id) {
        if (event === "SIGNED_OUT") {
          setAuthReady(false);
          setSamples([]);
        }
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

    const chronologicalSamples = [...samples]
      .filter((row) => row?.created_at && !Number.isNaN(new Date(row.created_at).getTime()))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const parameterPlots = Object.values(PARAMETER_REFERENCE_META).map((meta) => {
      const points = chronologicalSamples
        .map((row) => {
          const y = numeric(row?.[meta.key]);
          if (!Number.isFinite(y)) return null;
          return {
            x: row.created_at,
            y,
            source: row?.source || "Unknown source",
            riskLevel: String(row?.risk_level || "unknown").toLowerCase(),
          };
        })
        .filter(Boolean)
        .slice(-60);

      const pointValues = points.map((point) => point.y);
      const avg = average(pointValues);
      const med = median(pointValues);

      let outOfReference = 0;
      points.forEach((point) => {
        if (meta.referenceType === "range") {
          if (point.y < meta.lower || point.y > meta.upper) outOfReference += 1;
          return;
        }
        if (meta.referenceType === "max" && point.y > meta.threshold) {
          outOfReference += 1;
        }
      });

      return {
        ...meta,
        points,
        count: points.length,
        avg,
        median: med,
        outOfReference,
      };
    });

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

    const anomalyStatusCounts = { ok: 0, warning: 0, critical: 0, missing: 0, unknown: 0 };
    let totalAnomalyChecks = 0;
    let flaggedAnomalyChecks = 0;

    const anomalyRecentTrend = recent.map((row) => {
      const checks = parseAnomalyChecks(row?.anomaly_checks);
      if (!checks.length) {
        anomalyStatusCounts.missing += 1;
      }

      let flaggedForSample = 0;
      checks.forEach((check) => {
        const status = String(check?.status || "ok").toLowerCase();
        if (status === "ok") anomalyStatusCounts.ok += 1;
        else if (status === "warning") {
          anomalyStatusCounts.warning += 1;
          flaggedForSample += 1;
          flaggedAnomalyChecks += 1;
        } else if (status === "critical") {
          anomalyStatusCounts.critical += 1;
          flaggedForSample += 1;
          flaggedAnomalyChecks += 1;
        } else {
          anomalyStatusCounts.unknown += 1;
        }
      });

      totalAnomalyChecks += checks.length;
      return {
        label: compactTimeLabel(row?.created_at),
        flagged: flaggedForSample,
      };
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
      parameterPlots,
      anomalyStatusCounts,
      anomalyRecentTrend,
      totalAnomalyChecks,
      flaggedAnomalyChecks,
      insights,
    };
  }, [samples]);

  const hasChartData = analytics.total > 0;

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
                  <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/30 p-2">
                    <Plot
                      data={[
                        {
                          x: analytics.confidenceTrend.map((point) => point.label),
                          y: analytics.confidenceTrend.map((point) => point.value),
                          type: "scatter",
                          mode: "lines+markers",
                          name: "Observed confidence",
                          line: { color: "#0284c7", width: 2 },
                          marker: { color: "#0284c7", size: 6 },
                          hovertemplate: "%{x}<br>Confidence: %{y:.3f}<extra></extra>",
                        },
                        {
                          x: analytics.confidenceTrend.map((point) => point.label),
                          y: analytics.confidenceTrend.map(() => 0.5),
                          type: "scatter",
                          mode: "lines",
                          name: "Reference floor (0.50)",
                          line: { color: "#f59e0b", width: 1.5, dash: "dot" },
                          hovertemplate: "Reference: %{y:.2f}<extra></extra>",
                        },
                        {
                          x: analytics.confidenceTrend.map((point) => point.label),
                          y: analytics.confidenceTrend.map(() => 0.7),
                          type: "scatter",
                          mode: "lines",
                          name: "High-confidence mark (0.70)",
                          line: { color: "#16a34a", width: 1.5, dash: "dot" },
                          hovertemplate: "Reference: %{y:.2f}<extra></extra>",
                        },
                      ]}
                      layout={{
                        autosize: true,
                        height: 290,
                        margin: { l: 46, r: 16, t: 10, b: 42 },
                        paper_bgcolor: "rgba(255,255,255,0)",
                        plot_bgcolor: "#ffffff",
                        xaxis: {
                          title: "Recent sample sequence",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          title: "Confidence",
                          range: [0, 1],
                          tick0: 0,
                          dtick: 0.1,
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } },
                      }}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                        scrollZoom: false,
                      }}
                      useResizeHandler
                      style={{ width: "100%", height: "290px" }}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No chart data yet.</p>
                )}
              </article>

              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Risk index trajectory</p>
                <p className="mt-1 text-sm text-slate-500">Safe → unsafe mapped to a 0.15 → 0.88 risk proxy.</p>
                {hasChartData ? (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/30 p-2">
                    <Plot
                      data={[
                        {
                          x: analytics.riskTrend.map((point) => point.label),
                          y: analytics.riskTrend.map((point) => point.value),
                          type: "scatter",
                          mode: "lines+markers",
                          name: "Observed risk index",
                          line: { color: "#e11d48", width: 2 },
                          marker: { color: "#e11d48", size: 6 },
                          hovertemplate: "%{x}<br>Risk index: %{y:.3f}<extra></extra>",
                        },
                        {
                          x: analytics.riskTrend.map((point) => point.label),
                          y: analytics.riskTrend.map(() => 0.35),
                          type: "scatter",
                          mode: "lines",
                          name: "Borderline marker (0.35)",
                          line: { color: "#f59e0b", width: 1.5, dash: "dot" },
                          hovertemplate: "Reference: %{y:.2f}<extra></extra>",
                        },
                        {
                          x: analytics.riskTrend.map((point) => point.label),
                          y: analytics.riskTrend.map(() => 0.65),
                          type: "scatter",
                          mode: "lines",
                          name: "Watch marker (0.65)",
                          line: { color: "#fb923c", width: 1.5, dash: "dot" },
                          hovertemplate: "Reference: %{y:.2f}<extra></extra>",
                        },
                        {
                          x: analytics.riskTrend.map((point) => point.label),
                          y: analytics.riskTrend.map(() => 0.88),
                          type: "scatter",
                          mode: "lines",
                          name: "Unsafe marker (0.88)",
                          line: { color: "#7f1d1d", width: 1.5, dash: "dot" },
                          hovertemplate: "Reference: %{y:.2f}<extra></extra>",
                        },
                      ]}
                      layout={{
                        autosize: true,
                        height: 290,
                        margin: { l: 46, r: 16, t: 10, b: 42 },
                        paper_bgcolor: "rgba(255,255,255,0)",
                        plot_bgcolor: "#ffffff",
                        xaxis: {
                          title: "Recent sample sequence",
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        yaxis: {
                          title: "Risk index",
                          range: [0, 1],
                          tick0: 0,
                          dtick: 0.1,
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        legend: { orientation: "h", y: 1.2, x: 0, font: { size: 10, color: "#475569" } },
                      }}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                        scrollZoom: false,
                      }}
                      useResizeHandler
                      style={{ width: "100%", height: "290px" }}
                    />
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
                {hasChartData ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <Plot
                      data={[
                        {
                          x: analytics.dayBuckets.map((bucket) => compactDateLabel(bucket.date)),
                          y: analytics.dayBuckets.map((bucket) => bucket.count),
                          type: "bar",
                          name: "Daily samples",
                          marker: { color: "#0ea5e9" },
                          text: analytics.dayBuckets.map((bucket) => String(bucket.count)),
                          textposition: "outside",
                          hovertemplate: "%{x}<br>Samples: %{y}<extra></extra>",
                        },
                      ]}
                      layout={{
                        autosize: true,
                        height: 300,
                        margin: { l: 44, r: 16, t: 10, b: 42 },
                        paper_bgcolor: "rgba(255,255,255,0)",
                        plot_bgcolor: "#ffffff",
                        xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
                        yaxis: {
                          title: "Sample count",
                          rangemode: "tozero",
                          dtick: 1,
                          gridcolor: "#e2e8f0",
                          tickfont: { size: 10, color: "#475569" },
                        },
                        showlegend: false,
                      }}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                        scrollZoom: false,
                      }}
                      useResizeHandler
                      style={{ width: "100%", height: "300px" }}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No volume data yet.</p>
                )}
              </article>

              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Outcome mix</p>
                <p className="mt-1 text-sm text-slate-500">Cleared, review, and alert distribution.</p>
                {analytics.statusDistribution.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <Plot
                      data={[
                        {
                          labels: analytics.statusDistribution.map((row) => row.name),
                          values: analytics.statusDistribution.map((row) => row.population),
                          type: "pie",
                          hole: 0.44,
                          sort: false,
                          direction: "clockwise",
                          marker: {
                            colors: analytics.statusDistribution.map((row) => {
                              if (row.name === "Cleared") return "#0ea5e9";
                              if (row.name === "Review") return "#f59e0b";
                              return "#f43f5e";
                            }),
                          },
                          textinfo: "percent+label",
                          hovertemplate: "%{label}<br>Count: %{value}<br>Share: %{percent}<extra></extra>",
                        },
                      ]}
                      layout={{
                        autosize: true,
                        height: 300,
                        margin: { l: 16, r: 16, t: 10, b: 10 },
                        paper_bgcolor: "rgba(255,255,255,0)",
                        showlegend: true,
                        legend: { orientation: "h", y: -0.12, x: 0.1, font: { size: 11, color: "#475569" } },
                      }}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                        scrollZoom: false,
                      }}
                      useResizeHandler
                      style={{ width: "100%", height: "300px" }}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No distribution data yet.</p>
                )}
              </article>
            </div>

            <article className="rounded-2xl border border-sky-200 bg-white p-6">
              <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Parameter intelligence</p>
              <p className="mt-1 text-sm text-slate-500">
                Plotly scatter trend charts using observed sample values with explicit reference thresholds for each model feature.
              </p>
              <div className="mt-4 grid gap-5 xl:grid-cols-2">
                {analytics.parameterPlots.map((plot) => {
                  const xSeries = plot.points.map((point) => point.x);
                  const ySeries = plot.points.map((point) => point.y);
                  const hasPoints = plot.count > 0;
                  const minX = xSeries[0] || new Date().toISOString();
                  const maxX = xSeries[xSeries.length - 1] || new Date().toISOString();

                  const referenceTraces = [];
                  if (hasPoints && plot.referenceType === "range") {
                    referenceTraces.push(
                      {
                        x: [minX, maxX],
                        y: [plot.lower, plot.lower],
                        type: "scatter",
                        mode: "lines",
                        name: `${plot.label} lower ref`,
                        line: { color: "#0f172a", dash: "dot", width: 1.5 },
                        hovertemplate: `Lower reference: %{y:.2f} ${plot.unit}<extra></extra>`,
                      },
                      {
                        x: [minX, maxX],
                        y: [plot.upper, plot.upper],
                        type: "scatter",
                        mode: "lines",
                        name: `${plot.label} upper ref`,
                        line: { color: "#0f172a", dash: "dot", width: 1.5 },
                        hovertemplate: `Upper reference: %{y:.2f} ${plot.unit}<extra></extra>`,
                      },
                    );
                  }

                  if (hasPoints && plot.referenceType === "max") {
                    referenceTraces.push({
                      x: [minX, maxX],
                      y: [plot.threshold, plot.threshold],
                      type: "scatter",
                      mode: "lines",
                      name: `${plot.label} max ref`,
                      line: { color: "#0f172a", dash: "dot", width: 1.5 },
                      hovertemplate: `Reference max: %{y:.2f} ${plot.unit}<extra></extra>`,
                    });
                  }

                  const referenceDescriptor =
                    plot.referenceType === "range"
                      ? `Reference band: ${plot.lower}-${plot.upper} ${plot.unit}`
                      : `Reference max: ≤ ${plot.threshold} ${plot.unit}`;

                  return (
                    <div key={plot.key} className="rounded-xl border border-sky-100 bg-sky-50/40 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-sky-900">{plot.label}</p>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                          Points: {plot.count}
                        </span>
                      </div>

                      {hasPoints ? (
                        <>
                          <Plot
                            data={[
                              {
                                x: xSeries,
                                y: ySeries,
                                type: "scatter",
                                mode: "lines+markers",
                                name: `${plot.label} observed`,
                                line: { color: plot.color, width: 2 },
                                marker: { color: plot.color, size: 6, opacity: 0.85 },
                                customdata: plot.points.map((point) => [point.source, point.riskLevel]),
                                hovertemplate:
                                  "%{x|%b %d, %Y %H:%M}<br>Value: %{y:.3f} " +
                                  plot.unit +
                                  "<br>Source: %{customdata[0]}<br>Risk: %{customdata[1]}<extra></extra>",
                              },
                              ...referenceTraces,
                            ]}
                            layout={{
                              autosize: true,
                              height: 280,
                              margin: { l: 48, r: 20, t: 10, b: 38 },
                              paper_bgcolor: "rgba(255,255,255,0)",
                              plot_bgcolor: "#ffffff",
                              xaxis: {
                                title: "Sample timestamp",
                                type: "date",
                                gridcolor: "#e2e8f0",
                                tickfont: { size: 10, color: "#475569" },
                                titlefont: { size: 11, color: "#334155" },
                              },
                              yaxis: {
                                title: `${plot.label} (${plot.unit})`,
                                gridcolor: "#e2e8f0",
                                zeroline: false,
                                tickfont: { size: 10, color: "#475569" },
                                titlefont: { size: 11, color: "#334155" },
                              },
                              legend: {
                                orientation: "h",
                                y: 1.14,
                                x: 0,
                                font: { size: 10, color: "#475569" },
                              },
                              hoverlabel: { bgcolor: "#0f172a", font: { color: "#f8fafc" } },
                            }}
                            config={{
                              responsive: true,
                              displaylogo: false,
                              modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                              scrollZoom: false,
                            }}
                            useResizeHandler
                            style={{ width: "100%", height: "280px" }}
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Average</p>
                              <p className="mt-1 font-semibold text-slate-700">{formatMetric(plot.avg)} {plot.unit}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Median</p>
                              <p className="mt-1 font-semibold text-slate-700">{formatMetric(plot.median)} {plot.unit}</p>
                            </div>
                            <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.22em] text-amber-700">Reference</p>
                              <p className="mt-1 font-medium text-amber-700">{referenceDescriptor}</p>
                              <p className="mt-1 text-[11px] text-amber-700">Out-of-reference points: {plot.outOfReference} / {plot.count}</p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="mt-3 text-sm text-slate-500">No valid values recorded yet for this parameter.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>

            <div className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Anomaly checks</p>
                <p className="mt-1 text-sm text-slate-500">
                  Distribution of anomaly-check outcomes and recent flagged-check intensity.
                </p>
                {(analytics.totalAnomalyChecks > 0 || analytics.anomalyStatusCounts.missing > 0) ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <Plot
                        data={[
                          {
                            labels: ["OK", "Warning", "Critical", "Missing", "Unknown"],
                            values: [
                              analytics.anomalyStatusCounts.ok,
                              analytics.anomalyStatusCounts.warning,
                              analytics.anomalyStatusCounts.critical,
                              analytics.anomalyStatusCounts.missing,
                              analytics.anomalyStatusCounts.unknown,
                            ],
                            type: "pie",
                            hole: 0.44,
                            marker: {
                              colors: ["#0ea5e9", "#f59e0b", "#f43f5e", "#94a3b8", "#64748b"],
                            },
                            textinfo: "percent+label",
                            hovertemplate: "%{label}<br>Count: %{value}<br>Share: %{percent}<extra></extra>",
                          },
                        ]}
                        layout={{
                          autosize: true,
                          height: 250,
                          margin: { l: 16, r: 16, t: 8, b: 8 },
                          paper_bgcolor: "rgba(255,255,255,0)",
                          showlegend: false,
                        }}
                        config={{
                          responsive: true,
                          displaylogo: false,
                          modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                          scrollZoom: false,
                        }}
                        useResizeHandler
                        style={{ width: "100%", height: "250px" }}
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <Plot
                        data={[
                          {
                            x: analytics.anomalyRecentTrend.map((entry) => entry.label),
                            y: analytics.anomalyRecentTrend.map((entry) => entry.flagged),
                            type: "scatter",
                            mode: "lines+markers",
                            name: "Flagged checks per sample",
                            line: { color: "#f43f5e", width: 2 },
                            marker: { color: "#f43f5e", size: 6 },
                            hovertemplate: "%{x}<br>Flagged checks: %{y}<extra></extra>",
                          },
                        ]}
                        layout={{
                          autosize: true,
                          height: 240,
                          margin: { l: 44, r: 16, t: 8, b: 40 },
                          paper_bgcolor: "rgba(255,255,255,0)",
                          plot_bgcolor: "#ffffff",
                          xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } },
                          yaxis: {
                            title: "Flagged checks",
                            rangemode: "tozero",
                            dtick: 1,
                            gridcolor: "#e2e8f0",
                            tickfont: { size: 10, color: "#475569" },
                          },
                          showlegend: false,
                        }}
                        config={{
                          responsive: true,
                          displaylogo: false,
                          modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"],
                          scrollZoom: false,
                        }}
                        useResizeHandler
                        style={{ width: "100%", height: "240px" }}
                      />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Total checks</p>
                        <p className="mt-1 text-lg font-semibold text-slate-700">{analytics.totalAnomalyChecks}</p>
                      </div>
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-rose-700">Flagged checks</p>
                        <p className="mt-1 text-lg font-semibold text-rose-700">{analytics.flaggedAnomalyChecks}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No anomaly checks available yet.</p>
                )}
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
