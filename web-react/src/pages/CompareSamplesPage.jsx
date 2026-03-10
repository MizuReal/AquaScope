import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { getCompareSummary } from "@/lib/api";

/* ── Constants ─────────────────────────────────────────────── */

const WATER_SAMPLES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";

const PARAMS = [
  { key: "ph", label: "pH", unit: "", safe: [6.5, 8.5], icon: "droplet" },
  { key: "hardness", label: "Hardness", unit: "mg/L", safe: [60, 180], icon: "shield" },
  { key: "solids", label: "TDS", unit: "mg/L", safe: [0, 500], icon: "layers" },
  { key: "chloramines", label: "Chloramines", unit: "ppm", safe: [0, 4], icon: "zap" },
  { key: "sulfate", label: "Sulfate", unit: "mg/L", safe: [0, 250], icon: "flask" },
  { key: "conductivity", label: "Conductivity", unit: "µS/cm", safe: [0, 500], icon: "bolt" },
  { key: "organic_carbon", label: "Organic Carbon", unit: "mg/L", safe: [0, 4], icon: "leaf" },
  { key: "trihalomethanes", label: "THMs", unit: "µg/L", safe: [0, 80], icon: "alert" },
  { key: "turbidity", label: "Turbidity", unit: "NTU", safe: [0, 5], icon: "eye" },
];

const PARAM_COLORS = {
  ph: { dot: "bg-emerald-400", ring: "ring-emerald-200", light: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
  hardness: { dot: "bg-sky-400", ring: "ring-sky-200", light: "bg-sky-50", text: "text-sky-700", border: "border-sky-300" },
  solids: { dot: "bg-slate-400", ring: "ring-slate-200", light: "bg-slate-50", text: "text-slate-700", border: "border-slate-300" },
  chloramines: { dot: "bg-amber-400", ring: "ring-amber-200", light: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
  sulfate: { dot: "bg-violet-400", ring: "ring-violet-200", light: "bg-violet-50", text: "text-violet-700", border: "border-violet-300" },
  conductivity: { dot: "bg-cyan-400", ring: "ring-cyan-200", light: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-300" },
  organic_carbon: { dot: "bg-lime-500", ring: "ring-lime-200", light: "bg-lime-50", text: "text-lime-700", border: "border-lime-300" },
  trihalomethanes: { dot: "bg-rose-400", ring: "ring-rose-200", light: "bg-rose-50", text: "text-rose-700", border: "border-rose-300" },
  turbidity: { dot: "bg-indigo-400", ring: "ring-indigo-200", light: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-300" },
};

const RISK_STYLE = {
  safe: { border: "border-emerald-400", bg: "bg-emerald-50", text: "text-emerald-700", badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  borderline: { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700", badge: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  watch: { border: "border-orange-400", bg: "bg-orange-50", text: "text-orange-700", badge: "border-orange-200 bg-orange-50 text-orange-700", dot: "bg-orange-400" },
  unsafe: { border: "border-rose-400", bg: "bg-rose-50", text: "text-rose-700", badge: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-400" },
};
const DEFAULT_RISK = { border: "border-slate-300", bg: "bg-slate-50", text: "text-slate-600", badge: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" };

const fmt = (v) =>
  v === null || v === undefined ? "--" : Number.isFinite(v) ? v.toFixed(2) : String(v);

const fmtDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const deltaInfo = (a, b, safeRange) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { icon: "", color: "", tag: "missing", improved: false };
  const diff = b - a;
  if (Math.abs(diff) < 0.005) return { icon: "=", color: "text-slate-400", tag: "same", improved: false };
  const midSafe = (safeRange[0] + safeRange[1]) / 2;
  const improved = Math.abs(b - midSafe) < Math.abs(a - midSafe);
  const arrow = diff > 0 ? "↑" : "↓";
  const color = improved ? "text-emerald-600" : "text-rose-500";
  const tag = improved ? "improved" : "worsened";
  return { icon: arrow, color, tag, improved };
};

/* ── Inline SVG icons ─────────────────────────────────────── */

const iconProps = { xmlns: "http://www.w3.org/2000/svg", className: "h-4 w-4", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };

const ParamIcon = ({ type }) => {
  if (type === "droplet") return <svg {...iconProps}><path d="M12 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10z" /></svg>;
  if (type === "shield") return <svg {...iconProps}><path d="M12 3l7 4v5c0 4.5-3 8.3-7 9.5-4-1.2-7-5-7-9.5V7l7-4z" /></svg>;
  if (type === "layers") return <svg {...iconProps}><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>;
  if (type === "zap") return <svg {...iconProps}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
  if (type === "flask") return <svg {...iconProps}><path d="M9 3h6" /><path d="M10 3v7.4a4 4 0 0 1-.8 2.4L6 17.6a2 2 0 0 0 1.6 3.4h8.8a2 2 0 0 0 1.6-3.4l-3.2-4.8A4 4 0 0 1 14 10.4V3" /></svg>;
  if (type === "bolt") return <svg {...iconProps}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
  if (type === "leaf") return <svg {...iconProps}><path d="M17 8c.6 5.4-2.6 8-6 10-3.4-2-6.6-4.6-6-10 3.2-.4 5.5-2.2 6-5 .5 2.8 2.8 4.6 6 5z" /></svg>;
  if (type === "alert") return <svg {...iconProps}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
  if (type === "eye") return <svg {...iconProps}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
  return <svg {...iconProps}><circle cx="12" cy="12" r="3" /></svg>;
};

const IconSparkle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" />
    <path d="m6.5 6.5 2.8 2.8" /><path d="m14.7 14.7 2.8 2.8" /><path d="m17.5 6.5-2.8 2.8" /><path d="m9.3 14.7-2.8 2.8" />
  </svg>
);

const IconSwap = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4" /><path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const IconWater = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10z" />
  </svg>
);

const IconCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* ── Safe-range micro bar ─────────────────────────────────── */

function SafeRangeBar({ value, safe, paramKey }) {
  if (!Number.isFinite(value)) return null;
  const colors = PARAM_COLORS[paramKey] || PARAM_COLORS.ph;
  // Range extends 50% beyond safe limits for visual context
  const rangeMin = safe[0] - (safe[1] - safe[0]) * 0.5;
  const rangeMax = safe[1] + (safe[1] - safe[0]) * 0.5;
  const pct = Math.max(0, Math.min(100, ((value - rangeMin) / (rangeMax - rangeMin)) * 100));
  const inSafe = value >= safe[0] && value <= safe[1];
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" title={`Safe: ${safe[0]}–${safe[1]}`}>
      {/* safe zone indicator */}
      <div className="relative h-full">
        <div
          className="absolute top-0 h-full bg-emerald-100/70"
          style={{
            left: `${Math.max(0, ((safe[0] - rangeMin) / (rangeMax - rangeMin)) * 100)}%`,
            width: `${((safe[1] - safe[0]) / (rangeMax - rangeMin)) * 100}%`,
          }}
        />
        <div
          className={`absolute top-0 h-full w-2 rounded-full ${inSafe ? colors.dot : "bg-rose-400"}`}
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
    </div>
  );
}

/* ── Summary stats helper ─────────────────────────────────── */

function useSummaryStats(sampleA, sampleB) {
  return useMemo(() => {
    if (!sampleA || !sampleB) return { improved: 0, worsened: 0, unchanged: 0 };
    let improved = 0, worsened = 0, unchanged = 0;
    for (const p of PARAMS) {
      const d = deltaInfo(sampleA[p.key], sampleB[p.key], p.safe);
      if (d.tag === "improved") improved++;
      else if (d.tag === "worsened") worsened++;
      else unchanged++;
    }
    return { improved, worsened, unchanged };
  }, [sampleA, sampleB]);
}

/* ── Sample selector card ─────────────────────────────────── */

function SampleSelector({ samples, selected, onSelect, label, accent }) {
  const gradients = accent === "a"
    ? "border-sky-400 bg-gradient-to-br from-sky-50 via-white to-white"
    : "border-indigo-400 bg-gradient-to-br from-indigo-50 via-white to-white";
  const accentText = accent === "a" ? "text-sky-600" : "text-indigo-600";
  const accentDot = accent === "a" ? "bg-sky-400" : "bg-indigo-400";
  const selectedSample = samples.find((s) => s.id === selected);
  const risk = RISK_STYLE[selectedSample?.risk_level?.toLowerCase()] || DEFAULT_RISK;

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border-2 p-4 shadow-sm transition-all ${gradients}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${accentDot}`} />
        <span className={`text-xs font-bold uppercase tracking-widest ${accentText}`}>{label}</span>
      </div>
      <select
        className="w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none backdrop-blur transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        value={selected || ""}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">Choose a sample...</option>
        {samples.map((s) => (
          <option key={s.id} value={s.id}>
            {s.sample_label || s.source || "Sample"} — {fmtDate(s.created_at)}
          </option>
        ))}
      </select>
      {selectedSample && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${selectedSample.prediction_is_potable ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
            {selectedSample.prediction_is_potable ? <><IconCheck /> Potable</> : <><IconX /> Not Potable</>}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${risk.badge}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${risk.dot}`} />
            {selectedSample.risk_level || "N/A"}
          </span>
          <span className="text-[11px] text-slate-400">{fmtDate(selectedSample.created_at)}</span>
        </div>
      )}
    </div>
  );
}

/* ── AI skeleton loader ───────────────────────────────────── */

function AiSkeleton() {
  return (
    <div className="space-y-2.5 animate-pulse">
      <div className="h-3 w-3/4 rounded bg-violet-100" />
      <div className="h-3 w-full rounded bg-violet-100" />
      <div className="h-3 w-5/6 rounded bg-violet-100" />
      <div className="h-3 w-2/3 rounded bg-violet-100" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main page
   ══════════════════════════════════════════════════════════════ */

export default function CompareSamplesPage() {
  const { user } = useAuth();
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [idA, setIdA] = useState(null);
  const [idB, setIdB] = useState(null);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Fetch all user water samples
  useEffect(() => {
    if (!supabase || !isSupabaseConfigured || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from(WATER_SAMPLES_TABLE)
          .select(
            "id, created_at, sample_label, source, risk_level, prediction_is_potable, prediction_probability, ph, hardness, solids, chloramines, sulfate, conductivity, organic_carbon, trihalomethanes, turbidity, microbial_risk, microbial_score, possible_bacteria"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        if (!cancelled) setSamples(data || []);
      } catch (err) {
        console.warn("Failed to fetch samples:", err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const sampleA = useMemo(() => samples.find((s) => s.id === idA), [samples, idA]);
  const sampleB = useMemo(() => samples.find((s) => s.id === idB), [samples, idB]);
  const canCompare = Boolean(sampleA && sampleB && idA !== idB);
  const stats = useSummaryStats(sampleA, sampleB);

  // ── Auto-trigger AI insight with 800ms debounce ────────────
  const fetchInsight = useCallback(async (a, b) => {
    if (!a || !b) return;
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort = true;
    const token = { abort: false };
    abortRef.current = token;

    setAiLoading(true);
    setAiError("");
    setAiSummary("");
    try {
      const res = await getCompareSummary(a, b);
      if (!token.abort) setAiSummary(res?.summary || "No summary returned.");
    } catch (err) {
      if (!token.abort) setAiError(err?.message || "Comparison failed.");
    } finally {
      if (!token.abort) setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort = true;
    setAiSummary("");
    setAiError("");

    if (!canCompare) { setAiLoading(false); return; }

    debounceRef.current = setTimeout(() => {
      fetchInsight(sampleA, sampleB);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [idA, idB, canCompare, sampleA, sampleB, fetchInsight]);

  // Swap samples
  const swapSamples = () => {
    setIdA(idB);
    setIdB(idA);
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <section className="px-6 py-10 lg:px-16">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-4 w-96 animate-pulse rounded bg-slate-100" />
          <div className="grid gap-4 pt-4 sm:grid-cols-2">
            <div className="h-32 animate-pulse rounded-2xl border-2 border-slate-100 bg-slate-50" />
            <div className="h-32 animate-pulse rounded-2xl border-2 border-slate-100 bg-slate-50" />
          </div>
        </div>
      </section>
    );
  }

  /* ── Empty state ── */
  if (samples.length < 2) {
    return (
      <section className="px-6 py-10 text-slate-900 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <header className="mb-8 space-y-2">
            <p className="text-sm uppercase tracking-[0.4em] text-sky-600">Compare</p>
            <h1 className="text-4xl font-semibold">Compare two samples</h1>
          </header>
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-500">
              <IconWater />
            </div>
            <p className="max-w-md text-slate-500">
              You need at least <span className="font-semibold text-slate-700">2 water quality samples</span> to compare.
              Run more predictions from the dashboard first.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-10 text-slate-900 lg:px-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        {/* ── Header ── */}
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.4em] text-sky-600">Compare</p>
          <h1 className="text-4xl font-semibold">Compare two samples</h1>
          <p className="text-base text-slate-500">
            Select any two water quality samples to view a side-by-side breakdown with AI-powered insights.
          </p>
        </header>

        {/* ── Sample selectors ── */}
        <div className="grid items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <SampleSelector samples={samples} selected={idA} onSelect={setIdA} label="Sample A — Before" accent="a" />
          <button
            onClick={swapSamples}
            disabled={!idA && !idB}
            className="flex h-10 w-10 items-center justify-center self-center rounded-full border-2 border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-sky-300 hover:text-sky-500 disabled:opacity-30"
            title="Swap samples"
          >
            <IconSwap />
          </button>
          <SampleSelector samples={samples} selected={idB} onSelect={setIdB} label="Sample B — After" accent="b" />
        </div>

        {idA && idB && idA === idB && (
          <div className="flex items-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Please select two different samples to compare.
          </div>
        )}

        {/* ── Quick stats ribbon ── */}
        {canCompare && (
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-3 rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-700">{stats.improved}</p>
                <p className="text-xs font-medium text-emerald-600">Improved</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border-2 border-rose-300 bg-gradient-to-br from-rose-50 to-white p-4 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-rose-700">{stats.worsened}</p>
                <p className="text-xs font-medium text-rose-600">Worsened</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-700">{stats.unchanged}</p>
                <p className="text-xs font-medium text-slate-500">Unchanged</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Parameter comparison table ── */}
        {canCompare && (
          <div className="overflow-hidden rounded-2xl border-2 border-sky-300 bg-white shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_6rem_6rem_5.5rem_5.5rem] items-center gap-x-3 border-b-2 border-sky-100 bg-gradient-to-r from-sky-50 via-white to-indigo-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <span>Parameter</span>
              <span className="text-center text-sky-600">Before</span>
              <span className="text-center text-indigo-600">After</span>
              <span className="text-center">Change</span>
              <span className="text-center">Status</span>
            </div>

            {/* Rows */}
            {PARAMS.map(({ key, label, unit, safe, icon }, i) => {
              const a = sampleA[key];
              const b = sampleB[key];
              const { icon: arrow, color, tag } = deltaInfo(a, b, safe);
              const diff = Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
              const pc = PARAM_COLORS[key] || PARAM_COLORS.ph;
              const tagStyle = tag === "improved"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : tag === "worsened"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-slate-50 text-slate-500";
              const tagLabel = tag === "improved" ? "Improved" : tag === "worsened" ? "Worsened" : tag === "same" ? "No change" : "--";

              return (
                <div
                  key={key}
                  className={`grid grid-cols-[1fr_6rem_6rem_5.5rem_5.5rem] items-center gap-x-3 px-5 py-2.5 text-sm transition ${
                    i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                  } ${i < PARAMS.length - 1 ? "border-b border-slate-100" : ""}`}
                >
                  {/* Parameter name + icon */}
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${pc.dot} text-white`}>
                      <ParamIcon type={icon} />
                    </span>
                    <span className="font-medium text-slate-800">
                      {label}
                      {unit && <span className="ml-1 text-[10px] font-normal text-slate-400">({unit})</span>}
                    </span>
                  </div>

                  {/* Before value */}
                  <span className="text-center tabular-nums text-slate-700">{fmt(a)}</span>

                  {/* After value */}
                  <span className="text-center tabular-nums text-slate-700">{fmt(b)}</span>

                  {/* Delta */}
                  <div className="flex items-center justify-center gap-1">
                    {arrow && <span className={`text-sm font-bold ${color}`}>{arrow}</span>}
                    {diff !== null && (
                      <span className={`text-xs font-semibold tabular-nums ${color}`}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                      </span>
                    )}
                    {tag === "missing" && <span className="text-xs text-slate-300">--</span>}
                  </div>

                  {/* Status badge */}
                  <span className={`inline-flex w-full justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase leading-tight ${tagStyle}`}>
                    {tagLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── AI Insight (auto-triggered) ── */}
        {canCompare && (
          <div className="overflow-hidden rounded-2xl border-2 border-violet-400 bg-gradient-to-br from-violet-50 via-purple-50 to-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-100/40 px-5 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-200 text-violet-600">
                <IconSparkle />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-violet-700">AI Comparison Insight</h3>
              {aiLoading && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-violet-500">
                  <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-violet-400" />
                  Analyzing...
                </span>
              )}
            </div>
            <div className="px-5 py-4">
              {aiLoading && <AiSkeleton />}
              {aiError && (
                <div className="flex items-start gap-2 text-sm text-rose-600">
                  <IconX />
                  <span>{aiError}</span>
                </div>
              )}
              {aiSummary && !aiLoading && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{aiSummary}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
