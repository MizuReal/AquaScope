import { useEffect, useMemo, useState } from "react";
import Lottie from "lottie-react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getContainerCleaningSuggestion, getWaterFiltrationSuggestion, assessMicrobialRisk } from "@/lib/api";

import noAnim from "@/assets/lottie/not.json";
import warnAnim from "@/assets/lottie/warning.json";
import yesAnim from "@/assets/lottie/yes.json";

const WATER_SAMPLES_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_SAMPLES_TABLE || "field_samples";
const CONTAINER_SCANS_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE ||
  import.meta.env.VITE_PUBLIC_CONTAINER_SAMPLES_TABLE ||
  "container_scans";

const formatContainerClassLabel = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const CONTAINER_CLASS_META = {
  Clean: { label: "Clean", color: "text-emerald-700", chip: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  LightMoss: { label: "Light Moss", color: "text-yellow-700", chip: "border-yellow-200 bg-yellow-50 text-yellow-700" },
  MediumMoss: { label: "Medium Moss", color: "text-orange-700", chip: "border-orange-200 bg-orange-50 text-orange-700" },
  HeavyMoss: { label: "Heavy Moss", color: "text-rose-700", chip: "border-rose-200 bg-rose-50 text-rose-700" },
  Unknown: { label: "Not Recognized", color: "text-slate-600", chip: "border-slate-200 bg-slate-50 text-slate-600" },
};

const CONTAINER_CLASS_ORDER = ["Clean", "LightMoss", "MediumMoss", "HeavyMoss"];

const getContainerSeverityNote = (predictedClass, isValid) => {
  if (!isValid) return "The image could not be confidently classified. Ensure the full container is clearly visible and try again.";
  if (predictedClass === "Clean") return "Container surface appears clean with no visible biological growth.";
  if (predictedClass === "LightMoss") return "Minor moss growth detected. Routine cleaning is recommended.";
  if (predictedClass === "MediumMoss") return "Moderate moss growth detected. Clean before next use.";
  if (predictedClass === "HeavyMoss") return "Heavy contamination detected. Immediate cleaning or replacement is advised.";
  return "Container class captured. Review confidence breakdown for detail.";
};

const formatTimestamp = (value) => {
  if (!value) return "timestamp unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "timestamp unavailable";
  return date.toLocaleString();
};

const deriveStatus = (riskLevel) => {
  const risk = (riskLevel || "").toLowerCase();
  if (risk === "safe" || risk === "borderline") return "Cleared";
  if (risk === "watch") return "Review";
  if (risk === "unsafe") return "Alert";
  return "Review";
};

const buildPredictedClass = (row) => {
  const isPotable = row?.prediction_is_potable;
  if (typeof isPotable !== "boolean") return row?.risk_level ? `Risk: ${row.risk_level}` : "Prediction pending";
  if (isPotable) return row?.risk_level ? `Potable (${row.risk_level})` : "Potable";
  return row?.risk_level ? `Non-potable (${row.risk_level})` : "Non-potable";
};

const buildContainerPredictedClass = (row) => {
  if (!row?.is_valid) return "Not Recognized";
  return formatContainerClassLabel(row?.predicted_class);
};

const deriveContainerStatus = (row) => {
  if (!row?.is_valid) return "Review";
  const predictedClass = String(row?.predicted_class || "").trim();
  if (predictedClass === "Clean") return "Cleared";
  if (predictedClass === "LightMoss") return "Review";
  if (predictedClass === "MediumMoss" || predictedClass === "HeavyMoss") return "Alert";
  return "Review";
};

const buildDisplayRow = (row, type) => {
  const confidence = Number.isFinite(
    type === "container" ? row?.confidence : row?.prediction_probability,
  )
    ? Number(type === "container" ? row.confidence : row.prediction_probability)
    : 0;
  return {
    id: row?.id || "unknown",
    timestamp: formatTimestamp(row?.created_at),
    location: row?.sample_label || row?.source || (type === "container" ? "Container" : "Sample"),
    predictedClass: type === "container" ? buildContainerPredictedClass(row) : buildPredictedClass(row),
    confidence,
    status: type === "container" ? deriveContainerStatus(row) : deriveStatus(row?.risk_level),
    raw: row,
    type,
  };
};

const STATUS_STYLES = {
  Cleared: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Review: "border-amber-200 bg-amber-50 text-amber-700",
  Alert: "border-rose-200 bg-rose-50 text-rose-700",
};

const CONFIDENCE_BANDS = [
  { label: "Low", range: [0, 0.5], color: "bg-rose-400" },
  { label: "Moderate", range: [0.5, 0.7], color: "bg-amber-400" },
  { label: "High", range: [0.7, 1], color: "bg-emerald-400" },
];

const getConfidenceMeta = (value) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  const band = CONFIDENCE_BANDS.find((entry) => safeValue >= entry.range[0] && safeValue < entry.range[1]);
  return band || CONFIDENCE_BANDS[0];
};

const getConfidenceAnimation = (value, threshold = 0.5, warningBand = 0.1) => {
  if (!Number.isFinite(value)) return noAnim;
  const lower = threshold - warningBand;
  const upper = threshold + warningBand;
  if (value < lower) return noAnim;
  if (value <= upper) return warnAnim;
  return yesAnim;
};

const CHECK_STYLES = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-rose-200 bg-rose-50 text-rose-700",
  missing: "border-slate-200 bg-slate-50 text-slate-500",
};

const RISK_BADGE_STYLES = {
  safe: "border-emerald-200 bg-emerald-50 text-emerald-700",
  borderline: "border-amber-200 bg-amber-50 text-amber-700",
  watch: "border-orange-200 bg-orange-50 text-orange-700",
  unsafe: "border-rose-200 bg-rose-50 text-rose-700",
  default: "border-slate-200 bg-slate-50 text-slate-600",
};

const MICROBIAL_STYLES = {
  high: { container: "border-rose-200 bg-rose-50", badge: "bg-rose-100 text-rose-700", text: "text-rose-700", icon: "🔴" },
  medium: { container: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-700", text: "text-amber-700", icon: "🟡" },
  low: { container: "border-emerald-200 bg-emerald-50", badge: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", icon: "🟢" },
  default: { container: "border-slate-200 bg-slate-50", badge: "bg-slate-100 text-slate-600", text: "text-slate-600", icon: "⚪" },
};

const RISK_SUMMARIES = {
  high: "Multiple WHO thresholds exceeded. Confirmatory lab testing recommended.",
  medium: "Some thresholds exceeded. Follow-up monitoring advised.",
  low: "All parameters within acceptable ranges.",
};

const normalizeFieldKey = (field = "") => field.toLowerCase();

const PARAMETER_COLORS = {
  ph: { dot: "bg-emerald-400", badge: "border-emerald-200 bg-emerald-50", text: "text-emerald-700" },
  hardness: { dot: "bg-sky-400", badge: "border-sky-200 bg-sky-50", text: "text-sky-700" },
  solids: { dot: "bg-slate-400", badge: "border-slate-200 bg-slate-50", text: "text-slate-700" },
  chloramines: { dot: "bg-amber-400", badge: "border-amber-200 bg-amber-50", text: "text-amber-700" },
  sulfate: { dot: "bg-violet-400", badge: "border-violet-200 bg-violet-50", text: "text-violet-700" },
  conductivity: { dot: "bg-cyan-400", badge: "border-cyan-200 bg-cyan-50", text: "text-cyan-700" },
  organic_carbon: { dot: "bg-lime-400", badge: "border-lime-200 bg-lime-50", text: "text-lime-700" },
  trihalomethanes: { dot: "bg-rose-400", badge: "border-rose-200 bg-rose-50", text: "text-rose-700" },
  turbidity: { dot: "bg-indigo-400", badge: "border-indigo-200 bg-indigo-50", text: "text-indigo-700" },
};

const FIELD_DISPLAY_NAMES = {
  ph: "pH",
  hardness: "Hardness",
  solids: "Total Dissolved Solids",
  chloramines: "Chloramines",
  sulfate: "Sulfate",
  conductivity: "Conductivity",
  organic_carbon: "Organic Carbon (TOC)",
  trihalomethanes: "Trihalomethanes",
  turbidity: "Turbidity",
};

const buildBacteriaFrequency = (violations) => {
  const freq = {};
  for (const v of violations) {
    for (const b of v.bacteria || []) {
      if (!freq[b]) freq[b] = [];
      if (!freq[b].includes(v.field)) freq[b].push(v.field);
    }
  }
  return Object.entries(freq).sort((a, b) => b[1].length - a[1].length);
};

const formatValue = (value, suffix = "") => {
  if (value === null || value === undefined) return "--";
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(2)}${suffix}`;
  return `${value}${suffix}`;
};

const formatAdvisorText = (text = "") =>
  String(text)
    .replace(/\r\n/g, "\n")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const toDateBoundaryIso = (value, endOfDay = false) => {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

const CATEGORY_CHIP_STYLES = {
  safe: { active: "bg-emerald-600 border-emerald-600 text-white", idle: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300" },
  borderline: { active: "bg-amber-500 border-amber-500 text-white", idle: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300" },
  watch: { active: "bg-orange-500 border-orange-500 text-white", idle: "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300" },
  unsafe: { active: "bg-rose-600 border-rose-600 text-white", idle: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300" },
  Clean: { active: "bg-emerald-600 border-emerald-600 text-white", idle: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300" },
  LightMoss: { active: "bg-yellow-500 border-yellow-500 text-white", idle: "border-yellow-200 bg-yellow-50 text-yellow-700 hover:border-yellow-300" },
  MediumMoss: { active: "bg-orange-500 border-orange-500 text-white", idle: "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300" },
  HeavyMoss: { active: "bg-rose-600 border-rose-600 text-white", idle: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300" },
  NOT_RECOGNIZED: { active: "bg-slate-500 border-slate-500 text-white", idle: "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300" },
};
const DEFAULT_CHIP = { active: "bg-sky-600 border-sky-600 text-white", idle: "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300" };

const formatFilterLabel = (value) => {
  const s = String(value || "").trim();
  if (!s) return "Unknown";
  if (s === "NOT_RECOGNIZED") return "Not Recognized";
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
};

export default function UserSamples() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("water");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [waterItems, setWaterItems] = useState([]);
  const [containerItems, setContainerItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailItem, setDetailItem] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [containerAdvisorText, setContainerAdvisorText] = useState("");
  const [containerAdvisorLoading, setContainerAdvisorLoading] = useState(false);
  const [containerAdvisorError, setContainerAdvisorError] = useState("");
  const [waterAdvisorText, setWaterAdvisorText] = useState("");
  const [waterAdvisorLoading, setWaterAdvisorLoading] = useState(false);
  const [waterAdvisorError, setWaterAdvisorError] = useState("");
  const [microbialViolations, setMicrobialViolations] = useState([]);
  const [microbialViolationsLoading, setMicrobialViolationsLoading] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);

  const items = useMemo(
    () => (activeTab === "water" ? waterItems : containerItems),
    [activeTab, waterItems, containerItems],
  );

  // ── Filter logic ──
  const filterKey = `${startDate}|${endDate}|${selectedCategories.slice().sort().join(",")}`;
  const hasActiveFilters = Boolean(startDate) || Boolean(endDate) || selectedCategories.length > 0;
  const activeFilterCount = (startDate || endDate ? 1 : 0) + selectedCategories.length;

  const toggleCategory = (cat) => {
    setSelectedCategories((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]);
    setPage(1);
  };

  const clearFilters = () => { setStartDate(""); setEndDate(""); setSelectedCategories([]); setPage(1); };

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setStartDate(""); setEndDate(""); setSelectedCategories([]); setPage(1);
  };

  // Fetch distinct category options for filter chips
  useEffect(() => {
    if (!supabase || !isSupabaseConfigured || !user?.id) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (activeTab === "water") {
          const { data } = await supabase.from(WATER_SAMPLES_TABLE).select("risk_level").eq("user_id", user.id).not("risk_level", "is", null);
          if (cancelled) return;
          const unique = [...new Set((data || []).map((r) => r.risk_level).filter(Boolean))];
          const order = ["safe", "borderline", "watch", "unsafe"];
          unique.sort((a, b) => (order.indexOf(a.toLowerCase()) < 0 ? 99 : order.indexOf(a.toLowerCase())) - (order.indexOf(b.toLowerCase()) < 0 ? 99 : order.indexOf(b.toLowerCase())));
          setCategoryOptions(unique);
        } else {
          const { data } = await supabase.from(CONTAINER_SCANS_TABLE).select("predicted_class, is_valid").eq("user_id", user.id);
          if (cancelled) return;
          const unique = [...new Set((data || []).map((r) => r.is_valid ? (r.predicted_class || "Unknown") : "NOT_RECOGNIZED").filter(Boolean))];
          const order = ["Clean", "LightMoss", "MediumMoss", "HeavyMoss", "NOT_RECOGNIZED"];
          unique.sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
          setCategoryOptions(unique);
        }
      } catch (err) { console.warn("[Supabase] category fetch:", err?.message || err); }
    };
    run();
    return () => { cancelled = true; };
  }, [activeTab, user?.id]);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;
    const userId = user?.id;
    if (!userId) return;

    let isMounted = true;

    const loadSamples = async () => {
      setLoading(true);
      setError("");
      try {
        const start = (page - 1) * pageSize;
        const end = start + pageSize - 1;

        if (activeTab === "water") {
          let q = supabase
            .from(WATER_SAMPLES_TABLE)
            .select("id, created_at, source, sample_label, color, notes, risk_level, model_version, prediction_probability, prediction_is_potable, anomaly_checks, microbial_risk, microbial_score, possible_bacteria, ph, hardness, solids, chloramines, sulfate, conductivity, organic_carbon, trihalomethanes, turbidity", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
          const sIso = toDateBoundaryIso(startDate, false);
          const eIso = toDateBoundaryIso(endDate, true);
          if (sIso) q = q.gte("created_at", sIso);
          if (eIso) q = q.lte("created_at", eIso);
          if (selectedCategories.length) q = q.in("risk_level", selectedCategories);
          const { data, error: samplesError, count } = await q.range(start, end);
          if (samplesError) throw samplesError;
          const mapped = (data || []).map((row) => buildDisplayRow(row, "water"));
          if (isMounted) { setWaterItems(mapped); setTotalCount(Number.isFinite(count) ? count : 0); }
        } else {
          let q = supabase
            .from(CONTAINER_SCANS_TABLE)
            .select("id, created_at, predicted_class, confidence, is_valid, rejection_reason, entropy, margin, probabilities, image_uri", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
          const sIso = toDateBoundaryIso(startDate, false);
          const eIso = toDateBoundaryIso(endDate, true);
          if (sIso) q = q.gte("created_at", sIso);
          if (eIso) q = q.lte("created_at", eIso);
          if (selectedCategories.length) q = q.in("predicted_class", selectedCategories);
          const { data, error: samplesError, count } = await q.range(start, end);
          if (samplesError) throw samplesError;
          const mapped = (data || []).map((row) => buildDisplayRow(row, "container"));
          if (isMounted) { setContainerItems(mapped); setTotalCount(Number.isFinite(count) ? count : 0); }
        }
      } catch (err) {
        console.warn("[Supabase] history fetch failed:", err?.message || err);
        if (isMounted) { setError("Unable to load history right now."); setTotalCount(0); }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadSamples();
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, page, pageSize, user?.id, filterKey]);

  useEffect(() => {
    if (!detailOpen || !detailItem || detailItem.type !== "container") {
      setContainerAdvisorText(""); setContainerAdvisorError(""); setContainerAdvisorLoading(false);
      return;
    }
    if (!detailItem.raw?.is_valid) {
      setContainerAdvisorText(""); setContainerAdvisorError(""); setContainerAdvisorLoading(false);
      return;
    }

    let cancelled = false;
    setContainerAdvisorText(""); setContainerAdvisorError(""); setContainerAdvisorLoading(true);

    const analysisPayload = {
      predicted_class: detailItem.raw?.predicted_class || "Unknown",
      confidence: Number.isFinite(detailItem.raw?.confidence) ? Number(detailItem.raw.confidence) : 0,
      is_valid: Boolean(detailItem.raw?.is_valid),
      rejection_reason: detailItem.raw?.rejection_reason || null,
      entropy: detailItem.raw?.entropy,
      margin: detailItem.raw?.margin,
      probabilities: detailItem.raw?.probabilities && typeof detailItem.raw.probabilities === "object" ? detailItem.raw.probabilities : {},
    };

    getContainerCleaningSuggestion(analysisPayload)
      .then((response) => { if (!cancelled) setContainerAdvisorText(response?.suggestion || "No suggestion available."); })
      .catch((err) => { if (!cancelled) setContainerAdvisorError(err?.message || "Failed to get cleaning guidance."); })
      .finally(() => { if (!cancelled) setContainerAdvisorLoading(false); });

    return () => { cancelled = true; };
  }, [detailOpen, detailItem]);

  // Microbial violations (on-the-fly assessment)
  useEffect(() => {
    if (!detailOpen || !detailItem || detailItem.type !== "water") {
      setMicrobialViolations([]); setMicrobialViolationsLoading(false);
      return;
    }
    const raw = detailItem.raw || {};
    const sample = {
      ph: raw.ph ?? null,
      hardness: raw.hardness ?? null,
      solids: raw.solids ?? null,
      chloramines: raw.chloramines ?? null,
      sulfate: raw.sulfate ?? null,
      conductivity: raw.conductivity ?? null,
      organicCarbon: raw.organic_carbon ?? null,
      trihalomethanes: raw.trihalomethanes ?? null,
      turbidity: raw.turbidity ?? null,
    };
    const provided = Object.values(sample).filter((v) => v !== null);
    if (provided.length < 2) { setMicrobialViolations([]); return; }
    let cancelled = false;
    setMicrobialViolationsLoading(true);
    assessMicrobialRisk(sample)
      .then((res) => { if (!cancelled) setMicrobialViolations(res?.microbialViolations || res?.microbial_violations || []); })
      .catch(() => { if (!cancelled) setMicrobialViolations([]); })
      .finally(() => { if (!cancelled) setMicrobialViolationsLoading(false); });
    return () => { cancelled = true; };
  }, [detailOpen, detailItem]);

  // Water advisor
  useEffect(() => {
    if (!detailOpen || !detailItem || detailItem.type !== "water") {
      setWaterAdvisorText(""); setWaterAdvisorError(""); setWaterAdvisorLoading(false);
      return;
    }

    let cancelled = false;
    setWaterAdvisorText(""); setWaterAdvisorError(""); setWaterAdvisorLoading(true);

    const raw = detailItem.raw || {};
    const analysisPayload = {
      isPotable: !!raw.prediction_is_potable,
      probability: Number.isFinite(raw.prediction_probability) ? Number(raw.prediction_probability) : 0,
      riskLevel: raw.risk_level || "unknown",
      modelVersion: raw.model_version || "model",
      checks: Array.isArray(raw.anomaly_checks) ? raw.anomaly_checks : [],
      microbialRiskLevel: raw.microbial_risk || null,
      microbialScore: Number.isFinite(raw.microbial_score) ? raw.microbial_score : null,
      possibleBacteria: Array.isArray(raw.possible_bacteria) ? raw.possible_bacteria : [],
      meta: { source: raw.source || null, color: raw.color || null, sampleLabel: raw.sample_label || null },
    };

    getWaterFiltrationSuggestion(analysisPayload)
      .then((response) => { if (!cancelled) setWaterAdvisorText(response?.suggestion || "No suggestion available."); })
      .catch((err) => { if (!cancelled) setWaterAdvisorError(err?.message || "Failed to get water quality guidance."); })
      .finally(() => { if (!cancelled) setWaterAdvisorLoading(false); });

    return () => { cancelled = true; };
  }, [detailOpen, detailItem]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(totalCount, page * pageSize);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-600 font-medium">Prediction history</p>
          <p className="text-base text-slate-600">Recent water-quality and container scans tied to your account.</p>
        </div>
        <div className="flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm uppercase tracking-[0.3em]">
          <button type="button" className={`rounded-full px-5 py-2.5 font-medium transition ${activeTab === "water" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-800"}`} onClick={() => switchTab("water")}>Water quality</button>
          <button type="button" className={`rounded-full px-5 py-2.5 font-medium transition ${activeTab === "container" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-800"}`} onClick={() => switchTab("container")}>Container history</button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setFilterOpen((p) => !p)}
          className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${filterOpen ? "bg-sky-50" : "bg-white hover:bg-slate-50"}`}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-100">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            </span>
            <span className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-700">Filters</span>
            {hasActiveFilters && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-sky-600 px-1.5 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); clearFilters(); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); clearFilters(); } }}
                className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-500 hover:bg-rose-100 transition cursor-pointer"
              >
                Clear
              </span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-slate-400 transition-transform ${filterOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </button>

        {filterOpen && (
          <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-white">
            {/* Date range */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400 mb-2">Date range</p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 transition"
                />
                <span className="text-xs text-slate-300">→</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 transition"
                />
              </div>
            </div>

            {/* Category chips */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400 mb-2">
                {activeTab === "water" ? "Risk category" : "Container class"}
              </p>
              {categoryOptions.length === 0 ? (
                <p className="text-xs text-slate-400">No categories available yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {categoryOptions.map((cat) => {
                    const isOn = selectedCategories.includes(cat);
                    const chip = CATEGORY_CHIP_STYLES[cat] || DEFAULT_CHIP;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${isOn ? chip.active : chip.idle}`}
                      >
                        {formatFilterLabel(cat)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3.5 text-sm uppercase tracking-[0.3em] text-slate-600">
        <span>Showing {startIndex}-{endIndex} of {totalCount}</span>
        <div className="flex items-center gap-3">
          <label htmlFor="pageSize" className="text-xs text-slate-500">Rows</label>
          <select id="pageSize" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-700 disabled:opacity-50" onClick={() => setPage((c) => Math.max(1, c - 1))} disabled={page === 1}>Prev</button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <button type="button" className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-700 disabled:opacity-50" onClick={() => setPage((c) => Math.min(totalPages, c + 1))} disabled={page >= totalPages}>Next</button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-12">
          <svg className="h-8 w-8 animate-spin text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <p className="mt-3 text-base text-slate-600">Loading your history…</p>
        </div>
      )}
      {error && !loading && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-base text-rose-700">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          <p className="mt-3 text-base font-medium text-slate-600">No records yet</p>
          <p className="mt-1 text-sm text-slate-500">Run a scan to populate this history.</p>
        </div>
      )}

      {/* ── Card grid ── */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2">
        {items.map((item) => {
          const statusStyle = STATUS_STYLES[item.status] || "border-slate-200 bg-slate-50 text-slate-500";
          const confidencePct = Math.round(item.confidence * 100);
          const isWater = item.type === "water";

          // Status icon
          const statusIcon = item.status === "Cleared"
            ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            : item.status === "Alert"
              ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.58 14.86A1 1 0 002.57 20h18.86a1 1 0 00.86-1.28l-8.58-14.86a1 1 0 00-1.72 0z" /></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

          // Confidence bar color
          const barColor = confidencePct >= 70 ? "from-emerald-400 to-emerald-600" : confidencePct >= 50 ? "from-amber-400 to-amber-500" : "from-rose-400 to-rose-500";

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { setDetailItem(item); setDetailOpen(true); }}
              className="group relative flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-sky-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              {/* Top row: icon + type badge + status */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${isWater ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600"}`}>
                    {isWater
                      ? <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4.97 0-8-3.58-8-7.5C4 9.64 12 3 12 3s8 6.64 8 10.5c0 3.92-3.03 7.5-8 7.5z" /></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 3v4h6V3" /></svg>
                    }
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-slate-900">{item.location}</p>
                    <p className="truncate text-sm text-slate-500">{item.timestamp}</p>
                  </div>
                </div>
                <span className={`mt-0.5 shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] ${statusStyle}`}>
                  {item.status}
                </span>
              </div>

              {/* Prediction + potability */}
              <div className="mt-5 flex items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Prediction</p>
                  <p className="mt-1 truncate text-base font-medium text-slate-800">{item.predictedClass}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Potability</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{confidencePct}<span className="text-sm font-medium text-slate-500">%</span></p>
                </div>
              </div>

              {/* Confidence bar */}
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all`} style={{ width: `${Math.min(100, Math.max(4, confidencePct))}%` }} />
              </div>

              {/* Footer: status icon + view hint */}
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {statusIcon}
                  <span className="text-sm text-slate-600">{item.status === "Cleared" ? "Within safe limits" : item.status === "Alert" ? "Action recommended" : "Needs review"}</span>
                </div>
                <span className="text-sm font-medium text-sky-500 opacity-0 transition group-hover:opacity-100">
                  View details →
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {detailItem ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 py-6">
          <div className={`max-h-full w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl transition duration-200 ease-out ${detailOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
            {/* Modal header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur-sm rounded-t-3xl">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${detailItem.type === "water" ? "bg-sky-100 text-sky-600" : "bg-violet-100 text-violet-600"}`}>
                  {detailItem.type === "water"
                    ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4.97 0-8-3.58-8-7.5C4 9.64 12 3 12 3s8 6.64 8 10.5c0 3.92-3.03 7.5-8 7.5z" /></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 3v4h6V3" /></svg>
                  }
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-600">{detailItem.type === "water" ? "Water analysis" : "Container detail"}</p>
                  <h2 className="truncate text-lg font-semibold text-slate-900">{detailItem.location}</h2>
                </div>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                onClick={() => { setDetailOpen(false); setTimeout(() => setDetailItem(null), 180); }}
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6">
            {(() => {
              const confidenceValue = Number.isFinite(detailItem.confidence) ? detailItem.confidence : 0;
              const confidencePct = Math.round(confidenceValue * 100);

              if (detailItem.type === "container") {
                const isValid = Boolean(detailItem.raw?.is_valid);
                const predictedClass = String(detailItem.raw?.predicted_class || "").trim();
                const containerMeta = isValid ? CONTAINER_CLASS_META[predictedClass] || CONTAINER_CLASS_META.Unknown : CONTAINER_CLASS_META.Unknown;
                const rejectionReason = detailItem.raw?.rejection_reason;
                const entropyValue = Number.isFinite(Number(detailItem.raw?.entropy)) ? Number(detailItem.raw.entropy) : null;
                const marginValue = Number.isFinite(Number(detailItem.raw?.margin)) ? Number(detailItem.raw.margin) : null;
                const probabilities = detailItem.raw?.probabilities && typeof detailItem.raw.probabilities === "object" ? detailItem.raw.probabilities : {};

                return (
                  <div className="mt-6 space-y-6">
                    <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="h-24 w-24 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                            {detailItem.raw?.image_uri ? <img src={detailItem.raw.image_uri} alt="Container scan" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No image</div>}
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Container class</p>
                            <h3 className={`mt-2 text-3xl font-semibold ${containerMeta.color}`}>{containerMeta.label}</h3>
                            <p className="mt-2 text-sm text-slate-500">{getContainerSeverityNote(predictedClass, isValid)}</p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.3em] ${containerMeta.chip}`}>{isValid ? "Container recognized" : "Not recognized"}</span>
                      </div>

                      <div className="mt-6 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Detection confidence</p>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600" style={{ width: `${Math.min(100, Math.max(0, confidenceValue * 100))}%` }} /></div>
                          <p className="mt-3 text-3xl font-semibold text-slate-900">{confidencePct}%</p>
                          <p className="mt-1 text-xs text-slate-500">Entropy {entropyValue != null ? entropyValue.toFixed(3) : "--"} · Margin {marginValue != null ? `${Math.round(marginValue * 100)}%` : "--"}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Scan status</p>
                          {isValid ? <p className="mt-3 text-sm text-slate-700">Container image passed validation and classification.</p> : <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{rejectionReason || "Image not recognized as a valid container capture."}</div>}
                        </div>
                      </div>

                      {isValid && (
                        <div className="rounded-3xl border border-slate-200 bg-white p-6">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Confidence breakdown</p>
                          <div className="mt-4 space-y-3">
                            {CONTAINER_CLASS_ORDER.map((classKey) => {
                              const value = Number(probabilities?.[classKey]) || 0;
                              return (
                                <div key={classKey}>
                                  <div className="mb-1 flex items-center justify-between text-xs text-slate-600"><span>{formatContainerClassLabel(classKey)}</span><span>{Math.round(value * 100)}%</span></div>
                                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-sky-600" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {isValid && (
                        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white p-5">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                              </span>
                              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-600">Container advisor</p>
                            </div>
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">AI</span>
                          </div>
                          <p className="mb-3 text-[11px] text-slate-400">Automated cleaning &amp; maintenance guidance based on container class: <span className={`font-semibold ${containerMeta.color}`}>{containerMeta.label}</span>.</p>
                          {containerAdvisorLoading ? (
                            <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-4">
                              <svg className="h-5 w-5 animate-spin text-violet-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                              <p className="text-sm text-slate-500">Generating cleaning guidance…</p>
                            </div>
                          ) : containerAdvisorError ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{containerAdvisorError}</div>
                          ) : containerAdvisorText ? (
                            <div className="rounded-xl border border-violet-100 bg-white p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-line">{formatAdvisorText(containerAdvisorText)}</div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Advisor results will appear here.</div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400"><span>{detailItem.timestamp}{detailItem.id ? ` · #${String(detailItem.id).slice(0, 8)}` : ""}</span></div>
                    </div>
                  </div>
                );
              }

              /* Water detail — redesigned */
              const decisionThreshold = 0.5;
              const isPotable = detailItem.raw?.prediction_is_potable;
              const verdictLabel = isPotable === true ? "Potable" : isPotable === false ? "Not potable" : "Prediction pending";
              const verdictColor = isPotable === true ? "text-emerald-600" : isPotable === false ? "text-rose-600" : "text-slate-500";
              const verdictBg = isPotable === true ? "from-emerald-50 to-white" : isPotable === false ? "from-rose-50 to-white" : "from-slate-50 to-white";
              const verdictIcon = isPotable === true
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                : isPotable === false
                  ? <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
              const riskLevelRaw = (detailItem.raw?.risk_level || "").toLowerCase();
              const riskBadge = RISK_BADGE_STYLES[riskLevelRaw] || RISK_BADGE_STYLES.default;
              const confidenceTier = getConfidenceMeta(confidenceValue);
              const confidenceAnimation = getConfidenceAnimation(confidenceValue, decisionThreshold, 0.1);
              const confidenceTextClass = confidenceTier.color.replace("bg-", "text-");
              const checks = Array.isArray(detailItem.raw?.anomaly_checks) ? detailItem.raw.anomaly_checks : [];
              const microbialRisk = detailItem.raw?.microbial_risk || detailItem.raw?.microbial_risk_level;
              const microbialScore = detailItem.raw?.microbial_score;
              const microbialMaxScore = detailItem.raw?.microbial_max_score || 14;
              const possibleBacteria = detailItem.raw?.possible_bacteria || [];
              const microbialStyle = MICROBIAL_STYLES[(microbialRisk || "").toLowerCase()] || MICROBIAL_STYLES.default;
              const distFromThreshold = Math.abs(confidenceValue - decisionThreshold);
              const stability = Math.min(distFromThreshold / 0.15, 1);
              const analyticsVerdict =
                confidenceValue >= 0.85 && stability >= 0.6
                  ? { text: "Strong prediction with stable margin.", color: "text-emerald-600", icon: "✦" }
                  : confidenceValue >= 0.65 && stability >= 0.3
                    ? { text: "Moderate prediction. Monitor for input sensitivity.", color: "text-sky-600", icon: "◆" }
                    : stability < 0.3
                      ? { text: "Borderline. Small changes could flip the outcome.", color: "text-amber-600", icon: "▲" }
                      : { text: "Weak signal. Additional data recommended.", color: "text-rose-600", icon: "●" };

              const checkStatusCounts = { ok: 0, warning: 0, critical: 0, missing: 0 };
              checks.forEach((c) => { const s = c.status || "ok"; checkStatusCounts[s] = (checkStatusCounts[s] || 0) + 1; });

              return (
                <div className="mt-6 space-y-5">

                  {/* ── Verdict hero ── */}
                  <div className={`rounded-3xl border border-slate-200 bg-gradient-to-br ${verdictBg} p-6`}>
                    <div className="flex items-start gap-4">
                      <div className="mt-1 shrink-0">{verdictIcon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className={`text-2xl font-bold ${verdictColor}`}>{verdictLabel}</h3>
                          <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${riskBadge}`}>{detailItem.raw?.risk_level || "pending"}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{detailItem.predictedClass}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            {detailItem.timestamp}
                          </span>
                          <span className="flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                            {detailItem.raw?.model_version || "model"}
                          </span>
                          {detailItem.id && <span>#{String(detailItem.id).slice(0, 8)}</span>}
                        </div>
                      </div>
                      <div className="hidden shrink-0 sm:block">
                        <div className="h-16 w-16"><Lottie animationData={confidenceAnimation} loop={false} /></div>
                      </div>
                    </div>
                  </div>

                  {/* ── Confidence + analytics row ── */}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Potability score</p>
                        </div>
                        <span className={`text-xs font-bold uppercase tracking-[0.2em] ${confidenceTextClass}`}>{confidenceTier.label}</span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                        <div className="flex h-full w-full"><div className="h-full w-[50%] bg-rose-200" /><div className="h-full w-[15%] bg-amber-200" /><div className="h-full w-[20%] bg-sky-200" /><div className="h-full w-[15%] bg-emerald-200" /></div>
                      </div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-all" style={{ width: `${Math.min(100, Math.max(5, confidenceValue * 100))}%` }} />
                      </div>
                      <div className="mt-3 flex items-end justify-between">
                        <p className="text-3xl font-bold tabular-nums text-slate-900">{confidencePct}<span className="text-lg font-medium text-slate-400">%</span></p>
                        <p className="text-xs text-slate-500">{confidenceValue >= decisionThreshold ? "Above" : "Below"} threshold ({Math.round(decisionThreshold * 100)}%)</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Prediction analytics</p>
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {[
                          { label: "Threshold distance", value: Math.min(Math.abs(confidenceValue - decisionThreshold) / Math.max(decisionThreshold, 1 - decisionThreshold), 1), color: "border-l-sky-400" },
                          { label: "Stability", value: stability, color: "border-l-amber-400" },
                        ].map((metric) => (
                          <div key={metric.label} className={`rounded-xl border border-slate-100 border-l-[3px] ${metric.color} bg-slate-50 p-3`}>
                            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">{metric.label}</p>
                            <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{Math.round(metric.value * 100)}%</p>
                          </div>
                        ))}
                      </div>
                      <div className={`mt-3 flex items-center gap-1.5 text-xs ${analyticsVerdict.color}`}>
                        <span>{analyticsVerdict.icon}</span>
                        <span>{analyticsVerdict.text}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Microbial risk ── */}
                  {(microbialRisk || microbialScore || possibleBacteria.length > 0) && (
                    <div className={`rounded-2xl border p-5 ${microbialStyle.container}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${microbialStyle.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Microbial risk assessment</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className={`text-xl font-bold ${microbialStyle.text}`}>{microbialRisk || "Unavailable"}</p>
                          <p className="mt-1 text-xs text-slate-500">{RISK_SUMMARIES[(microbialRisk || "").toLowerCase()] || "Microbial risk data pending."}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${microbialStyle.badge}`}>{microbialStyle.icon} {microbialRisk || "pending"}</span>
                      </div>
                      {Number.isFinite(microbialScore) && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs text-slate-500"><span>Composite risk score</span><span className="text-sm font-bold tabular-nums text-slate-700">{microbialScore} / {microbialMaxScore}</span></div>
                          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400" style={{ width: `${Math.min(100, Math.max(5, (microbialScore / microbialMaxScore) * 100))}%` }} /></div>
                        </div>
                      )}
                      {possibleBacteria.length > 0 && (
                        <div className="mt-4">
                          <p className={`text-xs font-semibold uppercase tracking-[0.2em] mb-2 ${microbialStyle.text}`}>Possible bacteria detected</p>
                          <div className="flex flex-wrap gap-2">
                            {possibleBacteria.map((b) => (
                              <span
                                key={b}
                                className={`rounded-full border px-3 py-1 text-xs font-medium italic ${
                                  (microbialRisk || "").toLowerCase() === "high"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : (microbialRisk || "").toLowerCase() === "medium"
                                      ? "border-amber-200 bg-amber-50 text-amber-700"
                                      : (microbialRisk || "").toLowerCase() === "low"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-slate-200 bg-slate-50 text-slate-600"
                                }`}
                              >
                                {b}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── WHO Threshold Violations ── */}
                  {microbialViolationsLoading ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <svg className="h-5 w-5 animate-spin text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      <p className="text-sm text-slate-500">Assessing WHO threshold violations…</p>
                    </div>
                  ) : microbialViolations.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-600">WHO Threshold Violations</p>
                        </div>
                        <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">{microbialViolations.length}</span>
                      </div>
                      <p className="text-xs text-slate-500 mb-4">{microbialViolations.length} parameter{microbialViolations.length > 1 ? "s" : ""} exceeded safe thresholds</p>
                      <div className="space-y-3">
                        {microbialViolations.map((v, i) => {
                          const fieldName = FIELD_DISPLAY_NAMES[v.field] || v.field || "Unknown";
                          const unit = v.unit || "";
                          const weightDots = "●".repeat(Math.min(v.weight || 0, 3)) + "○".repeat(3 - Math.min(v.weight || 0, 3));
                          return (
                            <div key={`${v.field}-${i}`} className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-900">{fieldName}</p>
                                  <p className="text-xs text-slate-500 mt-0.5">{v.rule || ""}</p>
                                </div>
                                <div className="text-right shrink-0 ml-4">
                                  <p className="text-base font-bold text-slate-800">
                                    {v.value != null ? Number(v.value).toFixed(2) : "—"}
                                    {unit && <span className="text-xs font-normal text-slate-500 ml-0.5">{unit}</span>}
                                  </p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">severity {weightDots}</p>
                                </div>
                              </div>
                              {(v.healthRisk || v.health_risk || v.biofilm) && (
                                <div className="px-4 pb-2 space-y-1">
                                  {(v.healthRisk || v.health_risk) && (
                                    <div className="flex items-start gap-1.5">
                                      <span className="text-xs text-rose-400 mt-px">⚕</span>
                                      <p className="text-xs text-slate-600"><span className="font-semibold text-slate-700">Health risk: </span>{v.healthRisk || v.health_risk}</p>
                                    </div>
                                  )}
                                  {v.biofilm && (
                                    <div className="flex items-start gap-1.5">
                                      <span className="text-xs text-sky-400 mt-px">◎</span>
                                      <p className="text-xs text-slate-600"><span className="font-semibold text-slate-700">Biofilm: </span>{v.biofilm}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                              {(v.bacteria || []).length > 0 && (
                                <div className="px-4 pb-3 pt-1">
                                  <div className="flex flex-wrap gap-1.5">
                                    {v.bacteria.map((b, j) => (
                                      <span key={`${b}-${j}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium italic text-slate-600">{b}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : !microbialViolationsLoading && microbialRisk ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      <p className="text-sm font-semibold text-emerald-700">All parameters within WHO thresholds</p>
                    </div>
                  ) : null}

                  {/* ── Possible Microbial Concerns (bacteria ↔ source cross-ref) ── */}
                  {(() => {
                    const bacteriaFreq = buildBacteriaFrequency(microbialViolations);
                    if (bacteriaFreq.length === 0) return null;
                    const threatColors = (count) => {
                      if (count >= 3) return { border: "border-rose-200", bg: "bg-rose-50", dot: "bg-rose-500", text: "text-rose-700" };
                      if (count >= 2) return { border: "border-amber-200", bg: "bg-amber-50", dot: "bg-amber-500", text: "text-amber-700" };
                      return { border: "border-slate-200", bg: "bg-slate-50", dot: "bg-slate-400", text: "text-slate-600" };
                    };
                    return (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex items-center gap-2 mb-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-600">Possible Microbial Concerns</p>
                        </div>
                        <p className="text-xs text-slate-500 mb-4">{bacteriaFreq.length} organism{bacteriaFreq.length > 1 ? "s" : ""} identified from {microbialViolations.length} violation{microbialViolations.length > 1 ? "s" : ""}</p>
                        <div className="space-y-2.5">
                          {bacteriaFreq.map(([bacterium, sources], i) => {
                            const tc = threatColors(sources.length);
                            return (
                              <div key={`${bacterium}-${i}`} className={`rounded-xl border ${tc.border} ${tc.bg} px-4 py-3`}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tc.dot}`} />
                                    <p className="text-sm font-semibold italic text-slate-800 truncate">{bacterium}</p>
                                  </div>
                                  <span className={`rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-[11px] font-bold ${tc.text}`}>
                                    {sources.length} source{sources.length > 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {sources.map((src, j) => (
                                    <span key={`${src}-${j}`} className="rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">{FIELD_DISPLAY_NAMES[src] || src}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Sample context + anomaly checks ── */}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Sample context</p>
                      </div>
                      <div className="space-y-2.5">
                        {[
                          { label: "Source", value: detailItem.raw?.source, icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
                          { label: "Color", value: detailItem.raw?.color, icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg> },
                          { label: "Label", value: detailItem.raw?.sample_label, icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg> },
                          { label: "Notes", value: detailItem.raw?.notes, icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
                        ].map((field) => (
                          <div key={field.label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                            {field.icon}
                            <span className="text-xs text-slate-400 w-14 shrink-0">{field.label}</span>
                            <span className="text-sm text-slate-700 truncate">{field.value || "n/a"}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Anomaly checks</p>
                        </div>
                        {checks.length > 0 && (
                          <div className="flex items-center gap-1.5 text-[10px]">
                            {checkStatusCounts.ok > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{checkStatusCounts.ok} OK</span>}
                            {checkStatusCounts.warning > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{checkStatusCounts.warning} Warn</span>}
                            {checkStatusCounts.critical > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{checkStatusCounts.critical} Crit</span>}
                          </div>
                        )}
                      </div>
                      {checks.length ? (
                        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                          {checks.map((check, index) => {
                            const checkIcon = check.status === "ok"
                              ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              : check.status === "critical"
                                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" /></svg>;
                            return (
                              <div key={`${check.field || "check"}-${index}`} className={`rounded-xl border p-3 ${CHECK_STYLES[check.status] || "border-slate-200 bg-white text-slate-600"}`}>
                                <div className="flex items-center gap-2.5">
                                  {checkIcon}
                                  <span className={`inline-block w-2 h-2 rounded-full ${PARAMETER_COLORS[normalizeFieldKey(check.field || check.label)]?.dot || "bg-slate-300"}`} />
                                  <span className="font-semibold text-sm text-slate-900 flex-1">{check.label || check.field || "Metric"}</span>
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">{check.status || "ok"}</span>
                                </div>
                                <div className="mt-2 ml-6.5 space-y-0.5">
                                  <p className="text-xs text-slate-500">Observed: <span className="font-medium text-slate-700">{formatValue(check.value)}</span></p>
                                  {check.detail && <p className="text-xs text-slate-400">{check.detail}</p>}
                                  {check.recommended_range && <p className="text-xs text-slate-400">Range: {formatValue(check.recommended_range?.[0])} – {formatValue(check.recommended_range?.[1])}</p>}
                                  {typeof check.z_score === "number" && Number.isFinite(check.z_score) && <p className="text-xs text-slate-400">Z-score: {check.z_score.toFixed(2)}</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 py-8 text-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                          <p className="mt-2 text-xs text-slate-400">No anomaly checks available.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── AI Water Advisor ── */}
                  <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-white p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                        </span>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-600">Water quality advisor</p>
                      </div>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">AI</span>
                    </div>
                    <p className="mb-3 text-[11px] text-slate-400">Automated filtration & safety guidance based on your sample analysis.</p>
                    {waterAdvisorLoading ? (
                      <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-4">
                        <svg className="h-5 w-5 animate-spin text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        <p className="text-sm text-slate-500">Generating water quality guidance…</p>
                      </div>
                    ) : waterAdvisorError ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{waterAdvisorError}</div>
                    ) : waterAdvisorText ? (
                      <div className="rounded-xl border border-sky-100 bg-white p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-line">{formatAdvisorText(waterAdvisorText)}</div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Advisor results will appear here.</div>
                    )}
                  </div>
                </div>
              );
            })()}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
