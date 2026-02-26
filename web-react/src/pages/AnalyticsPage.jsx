import { Suspense } from "react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import Plot from "@/lib/Plot";
import { exportAnalyticsPdf } from "@/lib/api";

const WATER_SAMPLES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";

const configMissing = !supabase || !isSupabaseConfigured;
const analyticsDebugEnabled = Boolean(import.meta.env.DEV);
const analyticsDebug = (...args) => {
  if (!analyticsDebugEnabled) return;
  console.debug("[analytics-auth]", ...args);
};

const numeric = (value) => { const p = Number(value); return Number.isFinite(p) ? p : null; };

const parseAnomalyChecks = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
};

const formatPercent = (v) => (!Number.isFinite(v) ? "--" : `${Math.round(v * 100)}%`);
const average = (vals = []) => (!vals.length ? null : vals.reduce((s, v) => s + v, 0) / vals.length);
const median = (vals = []) => { if (!vals.length) return null; const s = [...vals].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; };

const compactDateLabel = (v) => { const d = v ? new Date(v) : null; if (!d || Number.isNaN(d.getTime())) return "--"; return `${d.getMonth() + 1}/${d.getDate()}`; };
const compactTimeLabel = (v) => { const d = v ? new Date(v) : null; if (!d || Number.isNaN(d.getTime())) return "--"; return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

const riskToScore = (r = "") => { const n = String(r || "").toLowerCase(); if (n === "safe") return 0.15; if (n === "borderline") return 0.35; if (n === "watch") return 0.65; if (n === "unsafe") return 0.88; return 0.5; };
const riskToStatus = (r = "") => { const n = String(r || "").toLowerCase(); if (n === "safe" || n === "borderline") return "Cleared"; if (n === "watch") return "Review"; if (n === "unsafe") return "Alert"; return "Review"; };
const describePh = (v) => { if (!Number.isFinite(v)) return "No data"; if (v < 6.5) return "Acidic"; if (v > 8.5) return "Alkaline"; return "Balanced"; };
const describeTurbidity = (v) => { if (!Number.isFinite(v)) return "No data"; if (v <= 1) return "Very clear"; if (v <= 5) return "Acceptable"; return "Elevated"; };
const describeConductivity = (v) => { if (!Number.isFinite(v)) return "No data"; if (v < 250) return "Low mineral load"; if (v <= 600) return "Moderate mineral load"; return "High mineral load"; };
const describeHardness = (v) => { if (!Number.isFinite(v)) return "No data"; if (v < 60) return "Soft"; if (v <= 120) return "Moderate"; if (v <= 180) return "Hard"; return "Very hard"; };

const buildRecentDayBuckets = (samples, days = 7) => {
  const buckets = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) { const d = new Date(today); d.setDate(today.getDate() - offset); buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, date: d, count: 0 }); }
  samples.forEach((row) => { const d = row?.created_at ? new Date(row.created_at) : null; if (!d || Number.isNaN(d.getTime())) return; const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; const b = buckets.find((e) => e.key === k); if (b) b.count += 1; });
  return buckets;
};

const formatMetric = (v, digits = 2) => (!Number.isFinite(v) ? "--" : Number(v).toFixed(digits));

const formatReportTimestamp = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
};

const buildReportFileName = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `analytics-report-${y}${m}${d}-${hh}${mm}.pdf`;
};

const triggerBlobDownload = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const IconBot = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v3" />
    <circle cx="9" cy="13" r="1" />
    <circle cx="15" cy="13" r="1" />
    <path d="M9 16h6" />
  </svg>
);

const buildConfidenceInsight = (trend = [], avgProbability = null) => {
  if (!trend.length) return "No confidence trend is available yet. Add more samples so the assistant can detect reliability patterns.";
  const last = trend[trend.length - 1]?.value ?? 0;
  const first = trend[0]?.value ?? 0;
  const direction = last > first + 0.03 ? "improving" : last < first - 0.03 ? "declining" : "stable";
  return `Confidence appears ${direction}, with the latest prediction at ${Math.round(last * 100)}%. Overall average confidence is ${formatPercent(avgProbability || 0)}, so keep monitoring if values dip below 70%.`;
};

const buildRiskInsight = (trend = []) => {
  if (!trend.length) return "No risk trajectory is available yet. Record additional samples to estimate safety movement over time.";
  const latest = trend[trend.length - 1]?.value ?? 0.5;
  const maxRisk = Math.max(...trend.map((p) => Number(p?.value) || 0));
  const band = latest >= 0.88 ? "unsafe" : latest >= 0.65 ? "watch" : latest >= 0.35 ? "borderline" : "safe";
  return `Current risk sits in the ${band} band (index ${latest.toFixed(2)}). Peak recent risk reached ${maxRisk.toFixed(2)}, so prioritize follow-up checks when this index approaches 0.65 or higher.`;
};

const buildVolumeInsight = (dayBuckets = []) => {
  if (!dayBuckets.length) return "No daily volume trend is available yet. Start collecting routine entries to monitor operational consistency.";
  const total = dayBuckets.reduce((sum, day) => sum + (day.count || 0), 0);
  const busiest = [...dayBuckets].sort((a, b) => b.count - a.count)[0];
  return `You logged ${total} samples in the last 7 days. The busiest day was ${compactDateLabel(busiest?.date)} with ${busiest?.count || 0} entries, which is a good anchor for staffing and review scheduling.`;
};

const buildOutcomeInsight = (statusDistribution = []) => {
  if (!statusDistribution.length) return "Outcome distribution is not ready yet. Add validated samples so the assistant can profile cleared vs alert trends.";
  const total = statusDistribution.reduce((sum, item) => sum + (item.population || 0), 0);
  const top = [...statusDistribution].sort((a, b) => b.population - a.population)[0];
  const share = total ? Math.round((top.population / total) * 100) : 0;
  return `${top.name} is the dominant outcome at about ${share}% of current records. If Review or Alert grows week-over-week, prioritize source tracing and corrective sampling.`;
};

const buildParameterInsight = (plot) => {
  if (!plot?.count) return "No usable values for this parameter yet. Capture more readings so trend-based recommendations can be generated.";
  const refText = plot.referenceType === "range"
    ? `${plot.lower}–${plot.upper} ${plot.unit}`
    : `≤ ${plot.threshold} ${plot.unit}`;
  return `${plot.label} averages ${formatMetric(plot.avg)} ${plot.unit}, with ${plot.outOfReference}/${plot.count} points outside reference (${refText}). Keep this out-of-reference rate near 0% to reduce downstream risk variability.`;
};

const buildAnomalyInsight = (totalChecks, flaggedChecks, recentTrend = []) => {
  if (!totalChecks && !recentTrend.length) return "No anomaly-check output is available yet. Run more analyses to generate pattern-based quality warnings.";
  const flaggedRate = totalChecks ? Math.round((flaggedChecks / totalChecks) * 100) : 0;
  const latestFlagged = recentTrend.length ? recentTrend[recentTrend.length - 1]?.flagged || 0 : 0;
  return `Flagged anomalies account for about ${flaggedRate}% of checks, with ${latestFlagged} flagged checks in the most recent sample. Keep tracking this ratio to catch quality drift before it impacts potability outcomes.`;
};

const PARAMETER_REFERENCE_META = {
  ph: { key: "ph", label: "pH", unit: "pH", referenceType: "range", lower: 6.5, upper: 8.5, color: "#0ea5e9" },
  turbidity: { key: "turbidity", label: "Turbidity", unit: "NTU", referenceType: "max", threshold: 5, color: "#14b8a6" },
  conductivity: { key: "conductivity", label: "Conductivity", unit: "µS/cm", referenceType: "range", lower: 250, upper: 600, color: "#8b5cf6" },
  hardness: { key: "hardness", label: "Hardness", unit: "mg/L", referenceType: "range", lower: 60, upper: 180, color: "#f59e0b" },
};

export default function AnalyticsPage() {
  const [authReady, setAuthReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [samples, setSamples] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const authResolvedRef = useRef(false);
  const analyticsInFlightRef = useRef(false);
  const lastLoadedUserIdRef = useRef("");
  const hasLoadedDataRef = useRef(false);

  useEffect(() => {
    if (configMissing) return;
    let isMounted = true;
    let sessionTimeoutId;

    analyticsDebug("effect:init", {
      path: window.location.pathname,
      href: window.location.href,
      visibilityState: document.visibilityState,
      onLine: navigator.onLine,
    });

    const resolveChecking = () => {
      if (!isMounted) return;
      analyticsDebug("state:checking=false");
      setChecking(false);
    };

    const markAuthResolved = () => {
      authResolvedRef.current = true;
      if (sessionTimeoutId) {
        window.clearTimeout(sessionTimeoutId);
        sessionTimeoutId = undefined;
      }
    };

    const loadAnalytics = async (userId) => {
      if (analyticsInFlightRef.current && lastLoadedUserIdRef.current === userId) {
        analyticsDebug("loadAnalytics:skip-duplicate-inflight", { userId });
        return;
      }

      analyticsDebug("loadAnalytics:start", { userId });
      analyticsInFlightRef.current = true;
      lastLoadedUserIdRef.current = userId;
      setLoading(true); setError("");
      const sharedSelect = "id, created_at, source, risk_level, prediction_probability, prediction_is_potable, ph, turbidity, conductivity, hardness, solids, chloramines, sulfate, organic_carbon, trihalomethanes, microbial_risk, microbial_score, anomaly_checks";
      let queryTimeoutId;
      try {
        const queryPromise = supabase
          .from(WATER_SAMPLES_TABLE)
          .select(sharedSelect)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(120);

        const timeoutPromise = new Promise((_, reject) => {
          queryTimeoutId = window.setTimeout(() => {
            reject(new Error("Analytics query timed out"));
          }, 12000);
        });

        const { data, error: qe } = await Promise.race([queryPromise, timeoutPromise]);
        if (queryTimeoutId) {
          window.clearTimeout(queryTimeoutId);
          queryTimeoutId = undefined;
        }
        if (qe) throw qe;
        if (isMounted) {
          analyticsDebug("loadAnalytics:success", { rows: (data || []).length });
          hasLoadedDataRef.current = true;
          setSamples(data || []);
        }
      } catch (fe) {
        analyticsDebug("loadAnalytics:error", fe?.message || fe);
        if (isMounted) { setError(fe?.message || "Unable to load analytics data."); setSamples([]); }
      }
      finally {
        if (queryTimeoutId) {
          window.clearTimeout(queryTimeoutId);
        }
        analyticsInFlightRef.current = false;
        if (isMounted) {
          analyticsDebug("state:loading=false");
          setLoading(false);
        }
      }
    };

    const bootstrap = async () => {
      try {
        analyticsDebug("bootstrap:start");
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) => {
          sessionTimeoutId = window.setTimeout(() => {
            analyticsDebug("bootstrap:timeout", { ms: 7000 });
            reject(new Error("Session check timed out"));
          }, 7000);
        });

        const { data, error: se } = await Promise.race([sessionPromise, timeoutPromise]);
        analyticsDebug("bootstrap:getSession:resolved", {
          hasSession: !!data?.session,
          userId: data?.session?.user?.id || null,
          hasError: !!se,
          visibilityState: document.visibilityState,
        });
        if (sessionTimeoutId) {
          window.clearTimeout(sessionTimeoutId);
          sessionTimeoutId = undefined;
        }

        if (!isMounted) return;
        if (se) {
          if (authResolvedRef.current) {
            analyticsDebug("bootstrap:error-ignored-after-auth-resolved", se?.message || se);
            return;
          }
          analyticsDebug("bootstrap:getSession:error", se?.message || se);
          setAuthError("Unable to verify your session. Please try logging in again.");
          resolveChecking();
          setLoading(false);
          return;
        }
        const userId = data?.session?.user?.id;
        if (!userId) {
          if (authResolvedRef.current) {
            analyticsDebug("bootstrap:no-session-ignored-after-auth-resolved");
            return;
          }
          analyticsDebug("bootstrap:no-session");
          setAuthReady(false);
          resolveChecking();
          setLoading(false);
          return;
        }
        analyticsDebug("state:authReady=true", { userId });
        markAuthResolved();
        setAuthError("");
        setAuthReady(true);
        resolveChecking();
        await loadAnalytics(userId);
      } catch {
        if (!isMounted) return;
        if (authResolvedRef.current) {
          analyticsDebug("bootstrap:catch-ignored-after-auth-resolved", {
            visibilityState: document.visibilityState,
            onLine: navigator.onLine,
          });
          return;
        }
        analyticsDebug("bootstrap:catch", {
          visibilityState: document.visibilityState,
          onLine: navigator.onLine,
        });
        setAuthError("Unable to verify your session. Please try logging in again.");
        resolveChecking();
        setLoading(false);
      }
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      analyticsDebug("auth:event", {
        event,
        hasSession: !!session,
        userId: session?.user?.id || null,
        visibilityState: document.visibilityState,
      });
      if (!session?.user?.id) {
        if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
          if (event === "INITIAL_SESSION" && authResolvedRef.current) {
            analyticsDebug("auth:event:initial-session-ignored-after-auth-resolved");
            return;
          }
          analyticsDebug("auth:event:no-user", { event });
          if (event === "SIGNED_OUT") {
            authResolvedRef.current = false;
            hasLoadedDataRef.current = false;
            lastLoadedUserIdRef.current = "";
          }
          resolveChecking();
          setAuthReady(false);
          setSamples([]);
          setLoading(false);
        }
        return;
      }
      analyticsDebug("state:authReady=true(from event)", { userId: session.user.id });
      markAuthResolved();
      setAuthError("");
      setAuthReady(true);
      resolveChecking();

      if (
        (event === "SIGNED_IN" || event === "INITIAL_SESSION")
        && hasLoadedDataRef.current
        && lastLoadedUserIdRef.current === session.user.id
      ) {
        analyticsDebug("loadAnalytics:skip-duplicate-event", { event, userId: session.user.id });
        return;
      }

      await loadAnalytics(session.user.id);
    });

    const handleVisibility = () => {
      analyticsDebug("window:visibilitychange", { visibilityState: document.visibilityState });
    };

    const handleFocus = () => {
      analyticsDebug("window:focus", { visibilityState: document.visibilityState });
    };

    const handleBlur = () => {
      analyticsDebug("window:blur", { visibilityState: document.visibilityState });
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      analyticsDebug("effect:cleanup");
      isMounted = false;
      if (sessionTimeoutId) {
        window.clearTimeout(sessionTimeoutId);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      listener.subscription.unsubscribe();
    };
  }, []);

  const analytics = useMemo(() => {
    const total = samples.length;
    const potableCount = samples.filter((r) => r?.prediction_is_potable === true).length;
    const watchOrUnsafe = samples.filter((r) => { const risk = String(r?.risk_level || "").toLowerCase(); return risk === "watch" || risk === "unsafe"; }).length;
    const probabilityValues = samples.map((r) => numeric(r?.prediction_probability)).filter((v) => Number.isFinite(v));
    const avgProbability = average(probabilityValues);
    const medianProbability = median(probabilityValues);
    const recent = [...samples].reverse().slice(-12);
    const confidenceTrend = recent.map((r) => ({ label: compactTimeLabel(r?.created_at), value: Number.isFinite(numeric(r?.prediction_probability)) ? Number(r.prediction_probability) : 0 }));
    const riskTrend = recent.map((r) => ({ label: compactTimeLabel(r?.created_at), value: riskToScore(r?.risk_level) }));
    const dayBuckets = buildRecentDayBuckets(samples, 7);
    const statusCounts = { Cleared: 0, Review: 0, Alert: 0 };
    samples.forEach((r) => { statusCounts[riskToStatus(r?.risk_level)] += 1; });
    const statusDistribution = [{ name: "Cleared", population: statusCounts.Cleared }, { name: "Review", population: statusCounts.Review }, { name: "Alert", population: statusCounts.Alert }].filter((i) => i.population > 0);
    const phV = samples.map((r) => numeric(r?.ph)).filter(Number.isFinite);
    const turbV = samples.map((r) => numeric(r?.turbidity)).filter(Number.isFinite);
    const condV = samples.map((r) => numeric(r?.conductivity)).filter(Number.isFinite);
    const hardV = samples.map((r) => numeric(r?.hardness)).filter(Number.isFinite);
    const chronological = [...samples].filter((r) => r?.created_at && !Number.isNaN(new Date(r.created_at).getTime())).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const parameterPlots = Object.values(PARAMETER_REFERENCE_META).map((meta) => {
      const points = chronological.map((r) => { const y = numeric(r?.[meta.key]); if (!Number.isFinite(y)) return null; return { x: r.created_at, y, source: r?.source || "Unknown source", riskLevel: String(r?.risk_level || "unknown").toLowerCase() }; }).filter(Boolean).slice(-60);
      const pv = points.map((p) => p.y); const avg2 = average(pv); const med = median(pv);
      let outOfRef = 0; points.forEach((p) => { if (meta.referenceType === "range") { if (p.y < meta.lower || p.y > meta.upper) outOfRef += 1; return; } if (meta.referenceType === "max" && p.y > meta.threshold) outOfRef += 1; });
      return { ...meta, points, count: points.length, avg: avg2, median: med, outOfReference: outOfRef };
    });
    const parameterCards = [
      { key: "ph", label: "pH", avg: average(phV), median: median(phV), descriptor: describePh(average(phV)) },
      { key: "turbidity", label: "Turbidity", avg: average(turbV), median: median(turbV), descriptor: describeTurbidity(average(turbV)) },
      { key: "conductivity", label: "Conductivity", avg: average(condV), median: median(condV), descriptor: describeConductivity(average(condV)) },
      { key: "hardness", label: "Hardness", avg: average(hardV), median: median(hardV), descriptor: describeHardness(average(hardV)) },
    ];
    const anomalyStatusCounts = { ok: 0, warning: 0, critical: 0, missing: 0, unknown: 0 };
    let totalAnomalyChecks = 0; let flaggedAnomalyChecks = 0;
    const anomalyRecentTrend = recent.map((r) => {
      const checks = parseAnomalyChecks(r?.anomaly_checks); if (!checks.length) anomalyStatusCounts.missing += 1;
      let flagged = 0; checks.forEach((c) => { const s = String(c?.status || "ok").toLowerCase(); if (s === "ok") anomalyStatusCounts.ok += 1; else if (s === "warning") { anomalyStatusCounts.warning += 1; flagged += 1; flaggedAnomalyChecks += 1; } else if (s === "critical") { anomalyStatusCounts.critical += 1; flagged += 1; flaggedAnomalyChecks += 1; } else anomalyStatusCounts.unknown += 1; });
      totalAnomalyChecks += checks.length; return { label: compactTimeLabel(r?.created_at), flagged };
    });
    const insights = [];
    if (!total) { insights.push("No saved samples yet. Submit samples from Data Input to unlock analytics trends."); }
    else {
      insights.push(`You have ${total} saved samples with ${formatPercent(total ? potableCount / total : 0)} potable outcomes.`);
      insights.push(`Watch/unsafe samples count is ${watchOrUnsafe}, useful for targeted follow-up checks.`);
      if (Number.isFinite(avgProbability)) insights.push(`Average model confidence is ${formatPercent(avgProbability)} (median ${formatPercent(medianProbability || 0)}).`);
      const phAvg = average(phV); if (Number.isFinite(phAvg)) insights.push(`pH trend is ${describePh(phAvg).toLowerCase()} with average ${phAvg.toFixed(2)}.`);
      const turbAvg = average(turbV); if (Number.isFinite(turbAvg)) insights.push(`Turbidity is ${describeTurbidity(turbAvg).toLowerCase()} at ${turbAvg.toFixed(2)} NTU average.`);
    }
    return { total, potableCount, watchOrUnsafe, avgProbability, confidenceTrend, riskTrend, dayBuckets, statusDistribution, parameterCards, parameterPlots, anomalyStatusCounts, anomalyRecentTrend, totalAnomalyChecks, flaggedAnomalyChecks, insights };
  }, [samples]);

  const hasChartData = analytics.total > 0;

  const plotLayout = (overrides = {}) => ({ autosize: true, margin: { l: 46, r: 16, t: 10, b: 42 }, paper_bgcolor: "rgba(255,255,255,0)", plot_bgcolor: "#ffffff", ...overrides });

  const buildExportCharts = () => {
    const charts = [];

    charts.push({
      title: "Confidence trend",
      subtitle: "Latest prediction confidence sequence from recent samples.",
      insight: buildConfidenceInsight(analytics.confidenceTrend, analytics.avgProbability),
      data: [
        { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Observed confidence", line: { color: "#0284c7", width: 2 }, marker: { color: "#0284c7", size: 6 } },
        { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.5), type: "scatter", mode: "lines", name: "Reference floor (0.50)", line: { color: "#f59e0b", width: 1.5, dash: "dot" } },
        { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.7), type: "scatter", mode: "lines", name: "High-confidence mark (0.70)", line: { color: "#16a34a", width: 1.5, dash: "dot" } },
      ],
      layout: plotLayout({ height: 300, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Confidence", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } } }),
    });

    charts.push({
      title: "Risk index trajectory",
      subtitle: "Safe → unsafe mapped to a 0.15 → 0.88 risk proxy.",
      insight: buildRiskInsight(analytics.riskTrend),
      data: [
        { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Observed risk index", line: { color: "#e11d48", width: 2 }, marker: { color: "#e11d48", size: 6 } },
        { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.35), type: "scatter", mode: "lines", name: "Borderline marker (0.35)", line: { color: "#f59e0b", width: 1.5, dash: "dot" } },
        { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.65), type: "scatter", mode: "lines", name: "Watch marker (0.65)", line: { color: "#fb923c", width: 1.5, dash: "dot" } },
        { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.88), type: "scatter", mode: "lines", name: "Unsafe marker (0.88)", line: { color: "#7f1d1d", width: 1.5, dash: "dot" } },
      ],
      layout: plotLayout({ height: 300, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Risk index", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } } }),
    });

    charts.push({
      title: "Daily sample volume (7 days)",
      subtitle: "Operational throughput from your records.",
      insight: buildVolumeInsight(analytics.dayBuckets),
      data: [{ x: analytics.dayBuckets.map((b) => compactDateLabel(b.date)), y: analytics.dayBuckets.map((b) => b.count), type: "bar", name: "Daily samples", marker: { color: "#0ea5e9" }, text: analytics.dayBuckets.map((b) => String(b.count)), textposition: "outside" }],
      layout: plotLayout({ height: 300, xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Sample count", rangemode: "tozero", dtick: 1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, showlegend: false }),
    });

    charts.push({
      title: "Outcome mix",
      subtitle: "Cleared, review, and alert distribution.",
      insight: buildOutcomeInsight(analytics.statusDistribution),
      data: [{ labels: analytics.statusDistribution.map((r) => r.name), values: analytics.statusDistribution.map((r) => r.population), type: "pie", hole: 0.44, sort: false, direction: "clockwise", marker: { colors: analytics.statusDistribution.map((r) => r.name === "Cleared" ? "#0ea5e9" : r.name === "Review" ? "#f59e0b" : "#f43f5e") }, textinfo: "percent+label" }],
      layout: { autosize: true, height: 300, margin: { l: 16, r: 16, t: 10, b: 10 }, paper_bgcolor: "rgba(255,255,255,0)", showlegend: true, legend: { orientation: "h", y: -0.12, x: 0.1, font: { size: 11, color: "#475569" } } },
    });

    analytics.parameterPlots.forEach((plot) => {
      const xS = plot.points.map((p) => p.x);
      const yS = plot.points.map((p) => p.y);
      if (!plot.count) return;
      const minX = xS[0] || new Date().toISOString();
      const maxX = xS[xS.length - 1] || new Date().toISOString();
      const refTraces = [];
      if (plot.referenceType === "range") {
        refTraces.push(
          { x: [minX, maxX], y: [plot.lower, plot.lower], type: "scatter", mode: "lines", name: `${plot.label} lower ref`, line: { color: "#0f172a", dash: "dot", width: 1.5 } },
          { x: [minX, maxX], y: [plot.upper, plot.upper], type: "scatter", mode: "lines", name: `${plot.label} upper ref`, line: { color: "#0f172a", dash: "dot", width: 1.5 } },
        );
      }
      if (plot.referenceType === "max") {
        refTraces.push({ x: [minX, maxX], y: [plot.threshold, plot.threshold], type: "scatter", mode: "lines", name: `${plot.label} max ref`, line: { color: "#0f172a", dash: "dot", width: 1.5 } });
      }

      charts.push({
        title: `${plot.label} parameter trend`,
        subtitle: "Observed sample values with reference thresholds.",
        insight: buildParameterInsight(plot),
        data: [
          { x: xS, y: yS, type: "scatter", mode: "lines+markers", name: `${plot.label} observed`, line: { color: plot.color, width: 2 }, marker: { color: plot.color, size: 6, opacity: 0.85 }, customdata: plot.points.map((p) => [p.source, p.riskLevel]), hovertemplate: "%{x|%b %d, %Y %H:%M}<br>Value: %{y:.3f} " + plot.unit + "<br>Source: %{customdata[0]}<br>Risk: %{customdata[1]}<extra></extra>" },
          ...refTraces,
        ],
        layout: plotLayout({ height: 280, margin: { l: 48, r: 20, t: 10, b: 38 }, xaxis: { title: "Sample timestamp", type: "date", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" }, titlefont: { size: 11, color: "#334155" } }, yaxis: { title: `${plot.label} (${plot.unit})`, gridcolor: "#e2e8f0", zeroline: false, tickfont: { size: 10, color: "#475569" }, titlefont: { size: 11, color: "#334155" } }, legend: { orientation: "h", y: 1.14, x: 0, font: { size: 10, color: "#475569" } }, hoverlabel: { bgcolor: "#0f172a", font: { color: "#f8fafc" } } }),
        metrics: [
          { label: "Average", value: `${formatMetric(plot.avg)} ${plot.unit}` },
          { label: "Median", value: `${formatMetric(plot.median)} ${plot.unit}` },
          { label: "Reference", value: plot.referenceType === "range" ? `${plot.lower}-${plot.upper} ${plot.unit}` : `≤ ${plot.threshold} ${plot.unit}` },
          { label: "Out-of-reference", value: `${plot.outOfReference} / ${plot.count}` },
        ],
      });
    });

    charts.push({
      title: "Anomaly checks distribution",
      subtitle: "Distribution of anomaly-check outcomes.",
      insight: buildAnomalyInsight(analytics.totalAnomalyChecks, analytics.flaggedAnomalyChecks, analytics.anomalyRecentTrend),
      data: [{ labels: ["OK", "Warning", "Critical", "Missing", "Unknown"], values: [analytics.anomalyStatusCounts.ok, analytics.anomalyStatusCounts.warning, analytics.anomalyStatusCounts.critical, analytics.anomalyStatusCounts.missing, analytics.anomalyStatusCounts.unknown], type: "pie", hole: 0.44, marker: { colors: ["#0ea5e9", "#f59e0b", "#f43f5e", "#94a3b8", "#64748b"] }, textinfo: "percent+label" }],
      layout: { autosize: true, height: 250, margin: { l: 16, r: 16, t: 8, b: 8 }, paper_bgcolor: "rgba(255,255,255,0)", showlegend: false },
    });

    charts.push({
      title: "Anomaly flagged intensity",
      subtitle: "Recent flagged-check count per sample.",
      insight: buildAnomalyInsight(analytics.totalAnomalyChecks, analytics.flaggedAnomalyChecks, analytics.anomalyRecentTrend),
      data: [{ x: analytics.anomalyRecentTrend.map((e) => e.label), y: analytics.anomalyRecentTrend.map((e) => e.flagged), type: "scatter", mode: "lines+markers", name: "Flagged checks per sample", line: { color: "#f43f5e", width: 2 }, marker: { color: "#f43f5e", size: 6 } }],
      layout: plotLayout({ height: 240, margin: { l: 44, r: 16, t: 8, b: 40 }, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Flagged checks", rangemode: "tozero", dtick: 1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, showlegend: false }),
    });

    return charts;
  };

  const handleExportPdf = async () => {
    if (exporting || loading || !hasChartData) return;
    setExportError("");
    setExporting(true);
    try {
      const now = new Date();
      const payload = {
        reportTitle: "Analytics Report",
        generatedAt: formatReportTimestamp(now),
        summaryBadges: [
          `Unified records: ${analytics.total}`,
          `Potable outcomes: ${analytics.potableCount}`,
          `At-risk samples: ${analytics.watchOrUnsafe}`,
        ],
        chartsPerPage: 2,
        charts: buildExportCharts(),
      };
      const pdfBlob = await exportAnalyticsPdf(payload);
      triggerBlobDownload(pdfBlob, buildReportFileName(now));
    } catch (exportErr) {
      setExportError(exportErr?.message || "Unable to export analytics PDF.");
    } finally {
      setExporting(false);
    }
  };

  if (configMissing) return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="max-w-md space-y-4"><p className="text-xl font-semibold">Configure Supabase auth</p><p className="text-sm text-slate-500">Add VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY to .env so we can secure the analytics route.</p><Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">Return home</Link></div></div>);
  if (authError) return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="max-w-md space-y-4"><p className="text-xl font-semibold">Authentication unavailable</p><p className="text-sm text-slate-500">{authError}</p><Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">Return home</Link></div></div>);
  if (checking) return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="space-y-4"><p className="text-xl font-semibold">Verifying your session...</p><p className="text-sm text-slate-500">Hang tight while we secure your workspace.</p></div></div>);
  if (!authReady) return (<div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-900"><div className="space-y-4"><p className="text-xl font-semibold">Please sign in</p><p className="text-sm text-slate-500">Log in to view your analytics.</p><Link className="text-sm uppercase tracking-[0.3em] text-sky-600" to="/">Return home</Link></div></div>);

  const plotConfig = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"], scrollZoom: false };

  return (
    <section className="flex-1 bg-slate-100 px-6 py-10 lg:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-slate-900">
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Analytics</p>
              <h1 className="text-3xl font-semibold text-sky-950">Comprehensive sample intelligence</h1>
              <p className="max-w-3xl text-sm text-slate-600">End-to-end analytics across your saved records, including confidence trends, risk distribution, core parameter summaries, microbial profile, and automated insights.</p>
            </div>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={loading || exporting || !hasChartData}
              className="inline-flex items-center rounded-lg border border-sky-300 bg-sky-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "Exporting..." : "Export PDF"}
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700">Unified records: {analytics.total}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-medium text-emerald-700">Potable outcomes: {analytics.potableCount}</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700">At-risk samples: {analytics.watchOrUnsafe}</span>
          </div>
          {exportError && (
            <article className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {exportError}
            </article>
          )}
        </header>

        {loading ? (
          <article className="rounded-2xl border border-sky-200 bg-white p-6 text-sm text-slate-600">Loading analytics...</article>
        ) : (
          <Suspense fallback={<div className="rounded-2xl border border-sky-200 bg-white p-6 text-sm text-slate-600">Loading charts...</div>}>
            {error && <article className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</article>}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-sky-200 bg-white p-5"><p className="text-xs uppercase tracking-[0.3em] text-sky-700">Saved samples</p><p className="mt-2 text-3xl font-semibold text-sky-950">{analytics.total}</p></article>
              <article className="rounded-2xl border border-sky-200 bg-white p-5"><p className="text-xs uppercase tracking-[0.3em] text-sky-700">Potable rate</p><p className="mt-2 text-3xl font-semibold text-sky-900">{formatPercent(analytics.total ? analytics.potableCount / analytics.total : 0)}</p></article>
              <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs uppercase tracking-[0.3em] text-amber-700">Watch + unsafe</p><p className="mt-2 text-3xl font-semibold text-amber-700">{analytics.watchOrUnsafe}</p></article>
              <article className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><p className="text-xs uppercase tracking-[0.3em] text-sky-700">Avg confidence</p><p className="mt-2 text-3xl font-semibold text-sky-700">{formatPercent(analytics.avgProbability || 0)}</p></article>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Confidence trend</p>
                <p className="mt-1 text-sm text-slate-500">Latest prediction confidence sequence from recent samples.</p>
                {hasChartData ? (
                  <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/30 p-2">
                    <Plot data={[
                      { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Observed confidence", line: { color: "#0284c7", width: 2 }, marker: { color: "#0284c7", size: 6 }, hovertemplate: "%{x}<br>Confidence: %{y:.3f}<extra></extra>" },
                      { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.5), type: "scatter", mode: "lines", name: "Reference floor (0.50)", line: { color: "#f59e0b", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                      { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.7), type: "scatter", mode: "lines", name: "High-confidence mark (0.70)", line: { color: "#16a34a", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                    ]} layout={plotLayout({ height: 290, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Confidence", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } } })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "290px" }} />
                  </div>
                ) : <p className="mt-4 text-sm text-slate-500">No chart data yet.</p>}
                <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                  <p className="mt-1 leading-relaxed">{buildConfidenceInsight(analytics.confidenceTrend, analytics.avgProbability)}</p>
                </div>
              </article>

              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Risk index trajectory</p>
                <p className="mt-1 text-sm text-slate-500">Safe → unsafe mapped to a 0.15 → 0.88 risk proxy.</p>
                {hasChartData ? (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/30 p-2">
                    <Plot data={[
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Observed risk index", line: { color: "#e11d48", width: 2 }, marker: { color: "#e11d48", size: 6 }, hovertemplate: "%{x}<br>Risk index: %{y:.3f}<extra></extra>" },
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.35), type: "scatter", mode: "lines", name: "Borderline marker (0.35)", line: { color: "#f59e0b", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.65), type: "scatter", mode: "lines", name: "Watch marker (0.65)", line: { color: "#fb923c", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.88), type: "scatter", mode: "lines", name: "Unsafe marker (0.88)", line: { color: "#7f1d1d", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                    ]} layout={plotLayout({ height: 290, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Risk index", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.2, x: 0, font: { size: 10, color: "#475569" } } })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "290px" }} />
                  </div>
                ) : <p className="mt-4 text-sm text-slate-500">No risk trend data yet.</p>}
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                  <p className="mt-1 leading-relaxed">{buildRiskInsight(analytics.riskTrend)}</p>
                </div>
              </article>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <article className="rounded-2xl border border-slate-300 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Daily sample volume (7 days)</p>
                <p className="mt-1 text-sm text-slate-600">Operational throughput from your records.</p>
                {hasChartData ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <Plot data={[{ x: analytics.dayBuckets.map((b) => compactDateLabel(b.date)), y: analytics.dayBuckets.map((b) => b.count), type: "bar", name: "Daily samples", marker: { color: "#0ea5e9" }, text: analytics.dayBuckets.map((b) => String(b.count)), textposition: "outside", hovertemplate: "%{x}<br>Samples: %{y}<extra></extra>" }]} layout={plotLayout({ height: 300, xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Sample count", rangemode: "tozero", dtick: 1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, showlegend: false })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "300px" }} />
                  </div>
                ) : <p className="mt-4 text-sm text-slate-500">No volume data yet.</p>}
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                  <p className="mt-1 leading-relaxed">{buildVolumeInsight(analytics.dayBuckets)}</p>
                </div>
              </article>

              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Outcome mix</p>
                <p className="mt-1 text-sm text-slate-500">Cleared, review, and alert distribution.</p>
                {analytics.statusDistribution.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <Plot data={[{ labels: analytics.statusDistribution.map((r) => r.name), values: analytics.statusDistribution.map((r) => r.population), type: "pie", hole: 0.44, sort: false, direction: "clockwise", marker: { colors: analytics.statusDistribution.map((r) => r.name === "Cleared" ? "#0ea5e9" : r.name === "Review" ? "#f59e0b" : "#f43f5e") }, textinfo: "percent+label", hovertemplate: "%{label}<br>Count: %{value}<br>Share: %{percent}<extra></extra>" }]} layout={{ autosize: true, height: 300, margin: { l: 16, r: 16, t: 10, b: 10 }, paper_bgcolor: "rgba(255,255,255,0)", showlegend: true, legend: { orientation: "h", y: -0.12, x: 0.1, font: { size: 11, color: "#475569" } } }} config={plotConfig} useResizeHandler style={{ width: "100%", height: "300px" }} />
                  </div>
                ) : <p className="mt-4 text-sm text-slate-500">No distribution data yet.</p>}
                <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                  <p className="mt-1 leading-relaxed">{buildOutcomeInsight(analytics.statusDistribution)}</p>
                </div>
              </article>
            </div>

            <article className="rounded-2xl border border-sky-200 bg-white p-6">
              <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Parameter intelligence</p>
              <p className="mt-1 text-sm text-slate-500">Plotly scatter trend charts using observed sample values with explicit reference thresholds for each model feature.</p>
              <div className="mt-4 grid gap-5 xl:grid-cols-2">
                {analytics.parameterPlots.map((plot) => {
                  const xS = plot.points.map((p) => p.x); const yS = plot.points.map((p) => p.y);
                  const has = plot.count > 0; const minX = xS[0] || new Date().toISOString(); const maxX = xS[xS.length - 1] || new Date().toISOString();
                  const refTraces = [];
                  if (has && plot.referenceType === "range") { refTraces.push({ x: [minX, maxX], y: [plot.lower, plot.lower], type: "scatter", mode: "lines", name: `${plot.label} lower ref`, line: { color: "#0f172a", dash: "dot", width: 1.5 }, hovertemplate: `Lower reference: %{y:.2f} ${plot.unit}<extra></extra>` }, { x: [minX, maxX], y: [plot.upper, plot.upper], type: "scatter", mode: "lines", name: `${plot.label} upper ref`, line: { color: "#0f172a", dash: "dot", width: 1.5 }, hovertemplate: `Upper reference: %{y:.2f} ${plot.unit}<extra></extra>` }); }
                  if (has && plot.referenceType === "max") { refTraces.push({ x: [minX, maxX], y: [plot.threshold, plot.threshold], type: "scatter", mode: "lines", name: `${plot.label} max ref`, line: { color: "#0f172a", dash: "dot", width: 1.5 }, hovertemplate: `Reference max: %{y:.2f} ${plot.unit}<extra></extra>` }); }
                  const refDesc = plot.referenceType === "range" ? `Reference band: ${plot.lower}-${plot.upper} ${plot.unit}` : `Reference max: ≤ ${plot.threshold} ${plot.unit}`;
                  return (
                    <div key={plot.key} className="rounded-xl border border-sky-100 bg-sky-50/40 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-sky-900">{plot.label}</p><span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">Points: {plot.count}</span></div>
                      {has ? (<>
                        <Plot data={[{ x: xS, y: yS, type: "scatter", mode: "lines+markers", name: `${plot.label} observed`, line: { color: plot.color, width: 2 }, marker: { color: plot.color, size: 6, opacity: 0.85 }, customdata: plot.points.map((p) => [p.source, p.riskLevel]), hovertemplate: "%{x|%b %d, %Y %H:%M}<br>Value: %{y:.3f} " + plot.unit + "<br>Source: %{customdata[0]}<br>Risk: %{customdata[1]}<extra></extra>" }, ...refTraces]} layout={plotLayout({ height: 280, margin: { l: 48, r: 20, t: 10, b: 38 }, xaxis: { title: "Sample timestamp", type: "date", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" }, titlefont: { size: 11, color: "#334155" } }, yaxis: { title: `${plot.label} (${plot.unit})`, gridcolor: "#e2e8f0", zeroline: false, tickfont: { size: 10, color: "#475569" }, titlefont: { size: 11, color: "#334155" } }, legend: { orientation: "h", y: 1.14, x: 0, font: { size: 10, color: "#475569" } }, hoverlabel: { bgcolor: "#0f172a", font: { color: "#f8fafc" } } })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "280px" }} />
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Average</p><p className="mt-1 font-semibold text-slate-700">{formatMetric(plot.avg)} {plot.unit}</p></div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Median</p><p className="mt-1 font-semibold text-slate-700">{formatMetric(plot.median)} {plot.unit}</p></div>
                          <div className="col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-amber-700">Reference</p><p className="mt-1 font-medium text-amber-700">{refDesc}</p><p className="mt-1 text-[11px] text-amber-700">Out-of-reference points: {plot.outOfReference} / {plot.count}</p></div>
                        </div>
                        <div className="mt-2 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs text-sky-800">
                          <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                          <p className="mt-1 leading-relaxed">{buildParameterInsight(plot)}</p>
                        </div>
                      </>) : <p className="mt-3 text-sm text-slate-500">No valid values recorded yet for this parameter.</p>}
                    </div>
                  );
                })}
              </div>
            </article>

            <div className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-2xl border border-sky-200 bg-white p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-sky-700">Anomaly checks</p>
                <p className="mt-1 text-sm text-slate-500">Distribution of anomaly-check outcomes and recent flagged-check intensity.</p>
                {(analytics.totalAnomalyChecks > 0 || analytics.anomalyStatusCounts.missing > 0) ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <Plot data={[{ labels: ["OK", "Warning", "Critical", "Missing", "Unknown"], values: [analytics.anomalyStatusCounts.ok, analytics.anomalyStatusCounts.warning, analytics.anomalyStatusCounts.critical, analytics.anomalyStatusCounts.missing, analytics.anomalyStatusCounts.unknown], type: "pie", hole: 0.44, marker: { colors: ["#0ea5e9", "#f59e0b", "#f43f5e", "#94a3b8", "#64748b"] }, textinfo: "percent+label", hovertemplate: "%{label}<br>Count: %{value}<br>Share: %{percent}<extra></extra>" }]} layout={{ autosize: true, height: 250, margin: { l: 16, r: 16, t: 8, b: 8 }, paper_bgcolor: "rgba(255,255,255,0)", showlegend: false }} config={plotConfig} useResizeHandler style={{ width: "100%", height: "250px" }} />
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <Plot data={[{ x: analytics.anomalyRecentTrend.map((e) => e.label), y: analytics.anomalyRecentTrend.map((e) => e.flagged), type: "scatter", mode: "lines+markers", name: "Flagged checks per sample", line: { color: "#f43f5e", width: 2 }, marker: { color: "#f43f5e", size: 6 }, hovertemplate: "%{x}<br>Flagged checks: %{y}<extra></extra>" }]} layout={plotLayout({ height: 240, margin: { l: 44, r: 16, t: 8, b: 40 }, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Flagged checks", rangemode: "tozero", dtick: 1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, showlegend: false })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "240px" }} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Total checks</p><p className="mt-1 text-lg font-semibold text-slate-700">{analytics.totalAnomalyChecks}</p></div>
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-rose-700">Flagged checks</p><p className="mt-1 text-lg font-semibold text-rose-700">{analytics.flaggedAnomalyChecks}</p></div>
                    </div>
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                      <p className="mt-1 leading-relaxed">{buildAnomalyInsight(analytics.totalAnomalyChecks, analytics.flaggedAnomalyChecks, analytics.anomalyRecentTrend)}</p>
                    </div>
                  </div>
                ) : <p className="mt-3 text-sm text-slate-500">No anomaly checks available yet.</p>}
              </article>

              <article className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
                <p className="text-xs uppercase tracking-[0.35em] text-emerald-700">Automated insights</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {analytics.insights.map((insight, i) => (<li key={`${insight}-${i}`} className="rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">{insight}</li>))}
                </ul>
              </article>
            </div>
          </Suspense>
        )}
      </div>
    </section>
  );
}
