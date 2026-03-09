import { Suspense } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import Plot from "@/lib/Plot";
import { exportAnalyticsPdf } from "@/lib/api";

const WATER_SAMPLES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";
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

const IconDatabase = ({ className = "h-5 w-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v4c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
    <path d="M3 9v4c0 1.66 4.03 3 9 3s9-1.34 9-3V9" />
    <path d="M3 13v4c0 1.66 4.03 3 9 3s9-1.34 9-3v-4" />
  </svg>
);

const IconShieldCheck = ({ className = "h-5 w-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M12 2l8 4v5c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V6z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const IconAlertTriangle = ({ className = "h-5 w-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconActivity = ({ className = "h-5 w-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconLayers = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const IconDroplets = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
    <path d="M12.56 6.6A10.97 10.97 0 0014 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 01-11.91 4.97" />
  </svg>
);

const IconCheckCircle = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const IconAlertOctagon = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const IconLightbulb = ({ className = "h-5 w-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M9 21h6" />
    <path d="M9 18h6" />
    <path d="M12 2a7 7 0 017 7c0 2.6-1.4 4.9-3.5 6.2V18H8.5v-2.8A7 7 0 0112 2z" />
  </svg>
);

const IconChevronDown = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconSpark = ({ className = "h-3.5 w-3.5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
  </svg>
);

const buildConfidenceInsight = (trend = [], avgProbability = null) => {
  if (!trend.length) return "No potability trend is available yet. Add more samples so the assistant can detect reliability patterns.";
  const last = trend[trend.length - 1]?.value ?? 0;
  const first = trend[0]?.value ?? 0;
  const direction = last > first + 0.03 ? "improving" : last < first - 0.03 ? "declining" : "stable";
  return `Potability score appears ${direction}, with the latest prediction at ${Math.round(last * 100)}%. Overall average potability is ${formatPercent(avgProbability || 0)}, so keep monitoring if values dip below 70%.`;
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
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [samples, setSamples] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const analyticsInFlightRef = useRef(false);
  const lastLoadedUserIdRef = useRef("");

  useEffect(() => {
    // DashboardLayout guarantees auth — user.id is always present here.
    if (!user?.id) return;
    let isMounted = true;

    analyticsDebug("effect:init", {
      path: window.location.pathname,
      href: window.location.href,
      visibilityState: document.visibilityState,
      onLine: navigator.onLine,
    });

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

    loadAnalytics(user.id);

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
      // Reset dedup refs so a remount (e.g. React StrictMode) triggers a fresh load
      // instead of silently skipping because the previous in-flight flag is still set.
      analyticsInFlightRef.current = false;
      lastLoadedUserIdRef.current = "";
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
      if (Number.isFinite(avgProbability)) insights.push(`Average potability score is ${formatPercent(avgProbability)} (median ${formatPercent(medianProbability || 0)}).`);
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
      title: "Potability trend",
      subtitle: "Latest potability score sequence from recent samples.",
      insight: buildConfidenceInsight(analytics.confidenceTrend, analytics.avgProbability),
      data: [
        { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Potability score", line: { color: "#0284c7", width: 2 }, marker: { color: "#0284c7", size: 6 } },
        { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.5), type: "scatter", mode: "lines", name: "Decision threshold (0.50)", line: { color: "#f59e0b", width: 1.5, dash: "dot" } },
        { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.7), type: "scatter", mode: "lines", name: "Strong potability mark (0.70)", line: { color: "#16a34a", width: 1.5, dash: "dot" } },
      ],
      layout: plotLayout({ height: 300, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Potability", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } } }),
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

  const plotConfig = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toImage"], scrollZoom: false };

  return (
    <section className="flex-1 bg-slate-100 px-6 py-10 lg:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-slate-900">
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Analytics</p>
              <h1 className="text-3xl font-semibold text-sky-950">Comprehensive sample intelligence</h1>
              <p className="max-w-3xl text-sm text-slate-600">End-to-end analytics across your saved records, including potability trends, risk distribution, core parameter summaries, microbial profile, and automated insights.</p>
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700">
              <IconLayers className="h-3.5 w-3.5" />Unified records: {analytics.total}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400 bg-emerald-50 px-4 py-1.5 text-xs font-medium text-emerald-700">
              <IconCheckCircle className="h-3.5 w-3.5" />Potable outcomes: {analytics.potableCount}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400 bg-rose-50 px-4 py-1.5 text-xs font-medium text-rose-600">
              <IconAlertOctagon className="h-3.5 w-3.5" />At-risk samples: {analytics.watchOrUnsafe}
            </span>
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
              <article className="relative overflow-hidden rounded-2xl border border-indigo-400 bg-gradient-to-br from-indigo-50 to-white p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-indigo-500">Saved samples</p>
                    <p className="mt-2 text-3xl font-semibold text-indigo-950">{analytics.total}</p>
                    <p className="mt-1 text-[11px] text-indigo-400">All records loaded</p>
                  </div>
                  <span className="rounded-xl bg-indigo-100 p-2.5 text-indigo-600"><IconDatabase className="h-5 w-5" /></span>
                </div>
              </article>
              <article className="relative overflow-hidden rounded-2xl border border-emerald-400 bg-gradient-to-br from-emerald-50 to-white p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-emerald-600">Potable rate</p>
                    <p className="mt-2 text-3xl font-semibold text-emerald-800">{formatPercent(analytics.total ? analytics.potableCount / analytics.total : 0)}</p>
                    <p className="mt-1 text-[11px] text-emerald-500">{analytics.potableCount} of {analytics.total} samples</p>
                  </div>
                  <span className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600"><IconShieldCheck className="h-5 w-5" /></span>
                </div>
              </article>
              <article className="relative overflow-hidden rounded-2xl border border-rose-400 bg-gradient-to-br from-rose-50 to-white p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-rose-500">Watch + unsafe</p>
                    <p className="mt-2 text-3xl font-semibold text-rose-700">{analytics.watchOrUnsafe}</p>
                    <p className="mt-1 text-[11px] text-rose-400">Require follow-up</p>
                  </div>
                  <span className="rounded-xl bg-rose-100 p-2.5 text-rose-500"><IconAlertTriangle className="h-5 w-5" /></span>
                </div>
              </article>
              <article className="relative overflow-hidden rounded-2xl border border-violet-400 bg-gradient-to-br from-violet-50 to-white p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-violet-500">Avg confidence</p>
                    <p className="mt-2 text-3xl font-semibold text-violet-800">{formatPercent(analytics.avgProbability || 0)}</p>
                    <p className="mt-1 text-[11px] text-violet-400">Model certainty score</p>
                  </div>
                  <span className="rounded-xl bg-violet-100 p-2.5 text-violet-600"><IconActivity className="h-5 w-5" /></span>
                </div>
              </article>
            </div>

            {/* ── Collapsible Automated Insights ── */}
            <div className="overflow-hidden rounded-2xl border border-amber-400 bg-gradient-to-br from-amber-50 via-yellow-50 to-white shadow-sm">
              <button
                type="button"
                onClick={() => setInsightsOpen((o) => !o)}
                className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-amber-50/60"
                aria-expanded={insightsOpen}
              >
                <div className="flex items-center gap-3.5">
                  <span className="rounded-xl bg-amber-100 p-2.5 text-amber-600">
                    <IconLightbulb className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Automated insights</p>
                    <p className="text-[11px] text-amber-500">
                      {analytics.insights.length} observation{analytics.insights.length !== 1 ? "s" : ""} generated from your sample history
                    </p>
                  </div>
                </div>
                <span className={`rounded-lg border border-amber-400 bg-white p-1.5 text-amber-500 transition-transform duration-200 ${insightsOpen ? "rotate-180" : ""}`}>
                  <IconChevronDown className="h-4 w-4" />
                </span>
              </button>

              {insightsOpen && (
                <div className="border-t border-amber-300 px-6 pb-5 pt-4">
                  {analytics.insights.length === 0 ? (
                    <p className="text-sm text-amber-700/70">No insights yet — submit samples to unlock pattern-based observations.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {analytics.insights.map((insight, i) => {
                        const palettes = [
                          { border: "border-indigo-300", bg: "bg-indigo-50", dot: "bg-indigo-400", text: "text-indigo-700" },
                          { border: "border-rose-300",   bg: "bg-rose-50",   dot: "bg-rose-400",   text: "text-rose-700" },
                          { border: "border-violet-300", bg: "bg-violet-50", dot: "bg-violet-400", text: "text-violet-700" },
                          { border: "border-sky-300",    bg: "bg-sky-50",    dot: "bg-sky-400",    text: "text-sky-700" },
                          { border: "border-teal-300",   bg: "bg-teal-50",   dot: "bg-teal-400",   text: "text-teal-700" },
                        ];
                        const p = palettes[i % palettes.length];
                        return (
                          <li key={i} className={`flex items-start gap-3 rounded-xl border ${p.border} ${p.bg} px-4 py-3`}>
                            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${p.dot}`} aria-hidden="true" />
                            <div className="flex-1">
                              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${p.text} mb-1`}>Insight {i + 1}</p>
                              <p className="text-sm leading-relaxed text-slate-700">{insight}</p>
                            </div>
                            <IconSpark className={`mt-1 h-3.5 w-3.5 flex-shrink-0 ${p.text} opacity-60`} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              {/* Potability trend */}
              <div className="rounded-xl border border-sky-300 bg-sky-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-sky-900">Potability trend</p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">Recent 12</span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">Latest potability score sequence from recent samples.</p>
                {hasChartData ? (
                  <>
                    <Plot data={[
                      { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Potability score", line: { color: "#0284c7", width: 2 }, marker: { color: "#0284c7", size: 6 }, hovertemplate: "%{x}<br>Potability: %{y:.3f}<extra></extra>" },
                      { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.5), type: "scatter", mode: "lines", name: "Decision threshold (0.50)", line: { color: "#f59e0b", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                      { x: analytics.confidenceTrend.map((p) => p.label), y: analytics.confidenceTrend.map(() => 0.7), type: "scatter", mode: "lines", name: "Strong potability mark (0.70)", line: { color: "#16a34a", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                    ]} layout={plotLayout({ height: 270, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Potability", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.15, x: 0, font: { size: 10, color: "#475569" } } })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "270px" }} />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Avg potability</p><p className="mt-1 font-semibold text-slate-700">{formatPercent(analytics.avgProbability || 0)}</p></div>
                      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Latest reading</p><p className="mt-1 font-semibold text-slate-700">{analytics.confidenceTrend.length ? formatPercent(analytics.confidenceTrend[analytics.confidenceTrend.length - 1].value) : "--"}</p></div>
                    </div>
                    <div className="mt-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs text-sky-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                      <p className="mt-1 leading-relaxed">{buildConfidenceInsight(analytics.confidenceTrend, analytics.avgProbability)}</p>
                    </div>
                  </>
                ) : <p className="mt-3 text-sm text-slate-500">No chart data yet.</p>}
              </div>

              {/* Risk index trajectory */}
              <div className="rounded-xl border border-rose-300 bg-rose-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-rose-900">Risk index trajectory</p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">Recent 12</span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">Safe → unsafe mapped to a 0.15 → 0.88 risk proxy.</p>
                {hasChartData ? (
                  <>
                    <Plot data={[
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map((p) => p.value), type: "scatter", mode: "lines+markers", name: "Observed risk index", line: { color: "#e11d48", width: 2 }, marker: { color: "#e11d48", size: 6 }, hovertemplate: "%{x}<br>Risk index: %{y:.3f}<extra></extra>" },
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.35), type: "scatter", mode: "lines", name: "Borderline (0.35)", line: { color: "#f59e0b", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.65), type: "scatter", mode: "lines", name: "Watch (0.65)", line: { color: "#fb923c", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                      { x: analytics.riskTrend.map((p) => p.label), y: analytics.riskTrend.map(() => 0.88), type: "scatter", mode: "lines", name: "Unsafe (0.88)", line: { color: "#7f1d1d", width: 1.5, dash: "dot" }, hovertemplate: "Reference: %{y:.2f}<extra></extra>" },
                    ]} layout={plotLayout({ height: 270, xaxis: { title: "Recent sample sequence", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Risk index", range: [0, 1], tick0: 0, dtick: 0.1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, legend: { orientation: "h", y: 1.2, x: 0, font: { size: 10, color: "#475569" } } })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "270px" }} />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Current index</p><p className="mt-1 font-semibold text-slate-700">{analytics.riskTrend.length ? analytics.riskTrend[analytics.riskTrend.length - 1].value.toFixed(2) : "--"}</p></div>
                      <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-rose-600">Peak risk</p><p className="mt-1 font-semibold text-rose-700">{analytics.riskTrend.length ? Math.max(...analytics.riskTrend.map((p) => p.value)).toFixed(2) : "--"}</p></div>
                    </div>
                    <div className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                      <p className="mt-1 leading-relaxed">{buildRiskInsight(analytics.riskTrend)}</p>
                    </div>
                  </>
                ) : <p className="mt-3 text-sm text-slate-500">No risk trend data yet.</p>}
              </div>

              {/* Daily sample volume */}
              <div className="rounded-xl border border-slate-400 bg-slate-50/60 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Daily sample volume</p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">7 days</span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">Operational throughput from your records.</p>
                {hasChartData ? (
                  <>
                    <Plot data={[{ x: analytics.dayBuckets.map((b) => compactDateLabel(b.date)), y: analytics.dayBuckets.map((b) => b.count), type: "bar", name: "Daily samples", marker: { color: "#0ea5e9" }, text: analytics.dayBuckets.map((b) => String(b.count)), textposition: "outside", hovertemplate: "%{x}<br>Samples: %{y}<extra></extra>" }]} layout={plotLayout({ height: 270, xaxis: { title: "Day", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, yaxis: { title: "Sample count", rangemode: "tozero", dtick: 1, gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" } }, showlegend: false })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "270px" }} />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">7-day total</p><p className="mt-1 font-semibold text-slate-700">{analytics.dayBuckets.reduce((s, b) => s + b.count, 0)}</p></div>
                      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Busiest day</p><p className="mt-1 font-semibold text-slate-700">{(() => { const b = [...analytics.dayBuckets].sort((a, c) => c.count - a.count)[0]; return b ? `${compactDateLabel(b.date)} (${b.count})` : "--"; })()}</p></div>
                    </div>
                    <div className="mt-2 rounded-lg border border-slate-400 bg-white px-3 py-2 text-xs text-slate-700">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                      <p className="mt-1 leading-relaxed">{buildVolumeInsight(analytics.dayBuckets)}</p>
                    </div>
                  </>
                ) : <p className="mt-3 text-sm text-slate-500">No volume data yet.</p>}
              </div>

              {/* Outcome mix */}
              <div className="rounded-xl border border-sky-300 bg-sky-50/40 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-sky-900">Outcome mix</p>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">Distribution</span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">Cleared, review, and alert distribution across all records.</p>
                {analytics.statusDistribution.length > 0 ? (
                  <>
                    <Plot data={[{ labels: analytics.statusDistribution.map((r) => r.name), values: analytics.statusDistribution.map((r) => r.population), type: "pie", hole: 0.44, sort: false, direction: "clockwise", marker: { colors: analytics.statusDistribution.map((r) => r.name === "Cleared" ? "#0ea5e9" : r.name === "Review" ? "#f59e0b" : "#f43f5e") }, textinfo: "percent+label", hovertemplate: "%{label}<br>Count: %{value}<br>Share: %{percent}<extra></extra>" }]} layout={{ autosize: true, height: 270, margin: { l: 16, r: 16, t: 10, b: 10 }, paper_bgcolor: "rgba(255,255,255,0)", showlegend: true, legend: { orientation: "h", y: -0.12, x: 0.1, font: { size: 11, color: "#475569" } } }} config={plotConfig} useResizeHandler style={{ width: "100%", height: "270px" }} />
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {analytics.statusDistribution.map((r) => (
                        <div key={r.name} className={`rounded-lg border px-3 py-2 ${r.name === "Cleared" ? "border-sky-200 bg-sky-50" : r.name === "Review" ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}>
                          <p className={`text-[10px] uppercase tracking-[0.22em] ${r.name === "Cleared" ? "text-sky-600" : r.name === "Review" ? "text-amber-600" : "text-rose-600"}`}>{r.name}</p>
                          <p className={`mt-1 font-semibold ${r.name === "Cleared" ? "text-sky-700" : r.name === "Review" ? "text-amber-700" : "text-rose-700"}`}>{r.population}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs text-sky-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                      <p className="mt-1 leading-relaxed">{buildOutcomeInsight(analytics.statusDistribution)}</p>
                    </div>
                  </>
                ) : <p className="mt-3 text-sm text-slate-500">No distribution data yet.</p>}
              </div>
            </div>

            <article className="rounded-2xl border border-sky-400 bg-white p-6">
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
                    <div key={plot.key} className="rounded-xl border border-sky-300 bg-sky-50/40 p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-sky-900">{plot.label}</p><span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600">Points: {plot.count}</span></div>
                      {has ? (<>
                        <Plot data={[{ x: xS, y: yS, type: "scatter", mode: "lines+markers", name: `${plot.label} observed`, line: { color: plot.color, width: 2 }, marker: { color: plot.color, size: 6, opacity: 0.85 }, customdata: plot.points.map((p) => [p.source, p.riskLevel]), hovertemplate: "%{x|%b %d, %Y %H:%M}<br>Value: %{y:.3f} " + plot.unit + "<br>Source: %{customdata[0]}<br>Risk: %{customdata[1]}<extra></extra>" }, ...refTraces]} layout={plotLayout({ height: 280, margin: { l: 48, r: 20, t: 10, b: 38 }, xaxis: { title: "Sample timestamp", type: "date", gridcolor: "#e2e8f0", tickfont: { size: 10, color: "#475569" }, titlefont: { size: 11, color: "#334155" } }, yaxis: { title: `${plot.label} (${plot.unit})`, gridcolor: "#e2e8f0", zeroline: false, tickfont: { size: 10, color: "#475569" }, titlefont: { size: 11, color: "#334155" } }, legend: { orientation: "h", y: 1.14, x: 0, font: { size: 10, color: "#475569" } }, hoverlabel: { bgcolor: "#0f172a", font: { color: "#f8fafc" } } })} config={plotConfig} useResizeHandler style={{ width: "100%", height: "280px" }} />
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Average</p><p className="mt-1 font-semibold text-slate-700">{formatMetric(plot.avg)} {plot.unit}</p></div>
                          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Median</p><p className="mt-1 font-semibold text-slate-700">{formatMetric(plot.median)} {plot.unit}</p></div>
                          <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-amber-700">Reference</p><p className="mt-1 font-medium text-amber-700">{refDesc}</p><p className="mt-1 text-[11px] text-amber-700">Out-of-reference points: {plot.outOfReference} / {plot.count}</p></div>
                        </div>
                        <div className="mt-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs text-sky-800">
                          <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                          <p className="mt-1 leading-relaxed">{buildParameterInsight(plot)}</p>
                        </div>
                      </>) : <p className="mt-3 text-sm text-slate-500">No valid values recorded yet for this parameter.</p>}
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="rounded-2xl border border-sky-400 bg-white p-6">
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
                      <div className="rounded-lg border border-slate-300 bg-white px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Total checks</p><p className="mt-1 text-lg font-semibold text-slate-700">{analytics.totalAnomalyChecks}</p></div>
                      <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2"><p className="text-[10px] uppercase tracking-[0.22em] text-rose-700">Flagged checks</p><p className="mt-1 text-lg font-semibold text-rose-700">{analytics.flaggedAnomalyChecks}</p></div>
                    </div>
                    <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                      <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><IconBot className="h-3.5 w-3.5" />Chatbot trend insight</p>
                      <p className="mt-1 leading-relaxed">{buildAnomalyInsight(analytics.totalAnomalyChecks, analytics.flaggedAnomalyChecks, analytics.anomalyRecentTrend)}</p>
                    </div>
                  </div>
                ) : <p className="mt-3 text-sm text-slate-500">No anomaly checks available yet.</p>}
            </article>
          </Suspense>
        )}
      </div>
    </section>
  );
}
