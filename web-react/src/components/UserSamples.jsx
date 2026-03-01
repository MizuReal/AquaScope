import { useEffect, useMemo, useState } from "react";
import Lottie from "lottie-react";

import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getContainerCleaningSuggestion } from "@/lib/api";

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

  const items = useMemo(
    () => (activeTab === "water" ? waterItems : containerItems),
    [activeTab, waterItems, containerItems],
  );

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
          const { data, error: samplesError, count } = await supabase
            .from(WATER_SAMPLES_TABLE)
            .select("id, created_at, source, sample_label, color, notes, risk_level, model_version, prediction_probability, prediction_is_potable, anomaly_checks, microbial_risk, microbial_score, possible_bacteria", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .range(start, end);
          if (samplesError) throw samplesError;
          const mapped = (data || []).map((row) => buildDisplayRow(row, "water"));
          if (isMounted) { setWaterItems(mapped); setTotalCount(Number.isFinite(count) ? count : 0); }
        } else {
          const { data, error: samplesError, count } = await supabase
            .from(CONTAINER_SCANS_TABLE)
            .select("id, created_at, predicted_class, confidence, is_valid, rejection_reason, entropy, margin, probabilities, image_uri", { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .range(start, end);
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
  }, [activeTab, page, pageSize, user?.id]);

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

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(totalCount, page * pageSize);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Prediction history</p>
          <p className="text-sm text-slate-500">Recent water-quality and container scans tied to your account.</p>
        </div>
        <div className="flex rounded-full border border-slate-200 bg-slate-50 p-1 text-xs uppercase tracking-[0.3em]">
          <button type="button" className={`rounded-full px-4 py-2 transition ${activeTab === "water" ? "bg-sky-600 text-white shadow-sm" : "text-slate-500"}`} onClick={() => setActiveTab("water")}>Water quality</button>
          <button type="button" className={`rounded-full px-4 py-2 transition ${activeTab === "container" ? "bg-sky-600 text-white shadow-sm" : "text-slate-500"}`} onClick={() => setActiveTab("container")}>Container history</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.3em] text-slate-500">
        <span>Showing {startIndex}-{endIndex} of {totalCount}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="pageSize" className="text-[10px] text-slate-400">Rows</label>
          <select id="pageSize" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-600" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
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

      {loading && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading your history...</div>}
      {error && !loading && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {!loading && !error && items.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No records yet. Run a scan to populate this history.</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.3em] text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Type</th>
              <th scope="col" className="px-4 py-3 text-left">Location</th>
              <th scope="col" className="px-4 py-3 text-left">Prediction</th>
              <th scope="col" className="px-4 py-3 text-left">Confidence</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
              <th scope="col" className="px-4 py-3 text-left">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {items.map((item) => {
              const statusStyle = STATUS_STYLES[item.status] || "border-slate-200 bg-slate-50 text-slate-500";
              const confidencePct = Math.round(item.confidence * 100);
              return (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 text-xs uppercase tracking-[0.3em] text-slate-500">{activeTab === "water" ? "Sample" : "Container"}</td>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-900">{item.location}</p><p className="text-xs text-slate-400">{item.id}</p></td>
                  <td className="px-4 py-3 text-slate-600">{item.predictedClass}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">{confidencePct}%</span>
                      <div className="h-1.5 w-24 rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600" style={{ width: `${Math.min(100, Math.max(5, item.confidence * 100))}%` }} /></div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] ${statusStyle}`}>{item.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="rounded-full border border-slate-300 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-400 hover:bg-slate-50" onClick={() => { setDetailItem(item); setDetailOpen(true); }}>View details</button>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{item.timestamp}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailItem ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm px-6 py-10">
          <div className={`max-h-full w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-xl transition duration-200 ease-out ${detailOpen ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-sky-600">{detailItem.type === "water" ? "Water analysis" : "Container detail"}</p>
                <h2 className="text-2xl font-semibold text-slate-900">{detailItem.location}</h2>
                <p className="text-sm text-slate-500">{detailItem.timestamp}</p>
              </div>
              <button type="button" className="rounded-full border border-slate-300 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 hover:bg-slate-50" onClick={() => { setDetailOpen(false); setTimeout(() => setDetailItem(null), 180); }}>Close</button>
            </div>

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
                        <div className="rounded-3xl border border-slate-200 bg-white p-6">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Container advisor</p>
                            <span className="rounded-full border border-sky-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-700">AI</span>
                          </div>
                          <p className="mb-3 text-xs text-slate-500">Based on class: {containerMeta.label}</p>
                          {containerAdvisorLoading ? <p className="text-sm text-slate-500">Generating cleaning guidance...</p> : containerAdvisorError ? <p className="text-sm text-rose-700">{containerAdvisorError}</p> : <p className="text-sm leading-6 text-slate-700">{formatAdvisorText(containerAdvisorText)}</p>}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400"><span>{detailItem.timestamp}{detailItem.id ? ` · #${String(detailItem.id).slice(0, 8)}` : ""}</span></div>
                    </div>
                  </div>
                );
              }

              /* Water detail */
              const decisionThreshold = 0.5;
              const isPotable = detailItem.raw?.prediction_is_potable;
              const verdictLabel = isPotable === true ? "Potable" : isPotable === false ? "Not potable" : "Prediction pending";
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
              const certainty = Math.abs(confidenceValue - 0.5) * 2;
              const margin = Math.min(Math.abs(confidenceValue - decisionThreshold) / decisionThreshold, 1);
              const signalStrength = confidenceValue >= 0.5 ? confidenceValue : 1 - confidenceValue;
              const distFromThreshold = Math.abs(confidenceValue - decisionThreshold);
              const stability = Math.min(distFromThreshold / 0.15, 1);
              const analyticsVerdict =
                certainty >= 0.7 && stability >= 0.6
                  ? { text: "Strong prediction with stable margin.", color: "text-emerald-600" }
                  : certainty >= 0.4 && stability >= 0.3
                    ? { text: "Moderate prediction. Monitor for input sensitivity.", color: "text-sky-600" }
                    : stability < 0.3
                      ? { text: "Borderline. Small changes could flip the outcome.", color: "text-amber-600" }
                      : { text: "Weak signal. Additional data recommended.", color: "text-rose-600" };

              return (
                <div className="mt-6 space-y-6">
                  <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Potability verdict</p>
                        <h3 className="mt-2 text-3xl font-semibold text-slate-900">{verdictLabel}</h3>
                        <p className="mt-2 text-sm text-slate-500">{detailItem.predictedClass}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-14 w-14"><Lottie animationData={confidenceAnimation} loop={false} /></div>
                        <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.3em] ${riskBadge}`}>{detailItem.raw?.risk_level || "pending"}</span>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Model confidence</p>
                          <span className={`text-xs font-semibold uppercase tracking-[0.3em] ${confidenceTextClass}`}>{confidenceTier.label}</span>
                        </div>
                        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                          <div className="flex h-full w-full"><div className="h-full w-[50%] bg-rose-200" /><div className="h-full w-[15%] bg-amber-200" /><div className="h-full w-[20%] bg-sky-200" /><div className="h-full w-[15%] bg-emerald-200" /></div>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600" style={{ width: `${Math.min(100, Math.max(5, confidenceValue * 100))}%` }} /></div>
                        <div className="mt-3 flex items-end justify-between">
                          <p className="text-3xl font-semibold text-slate-900">{confidencePct}%</p>
                          <p className="text-xs text-slate-500">{confidenceValue >= decisionThreshold ? "Above" : "Below"} threshold ({Math.round(decisionThreshold * 100)}%)</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Prediction analytics</p>
                        <div className="mt-4 grid gap-3 text-xs text-slate-500 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Certainty</p><p className="mt-2 text-base font-semibold text-slate-900">{Math.round(certainty * 100)}%</p></div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Margin</p><p className="mt-2 text-base font-semibold text-slate-900">{Math.round(margin * 100)}%</p></div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Signal strength</p><p className="mt-2 text-base font-semibold text-slate-900">{Math.round(signalStrength * 100)}%</p></div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Stability</p><p className="mt-2 text-base font-semibold text-slate-900">{Math.round(stability * 100)}%</p></div>
                        </div>
                        <p className={`mt-3 text-xs ${analyticsVerdict.color}`}>{analyticsVerdict.text}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      <span>{detailItem.timestamp} · {detailItem.raw?.model_version || "model unknown"}{detailItem.id ? ` · #${String(detailItem.id).slice(0, 8)}` : ""}</span>
                    </div>
                  </div>

                  {detailItem.type === "water" && (microbialRisk || microbialScore || possibleBacteria.length > 0) && (
                    <div className={`rounded-3xl border p-6 ${microbialStyle.container}`}>
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Microbial risk</p>
                          <p className={`mt-2 text-2xl font-semibold ${microbialStyle.text}`}>{microbialRisk || "Unavailable"}</p>
                          <p className="mt-2 text-sm text-slate-500">{RISK_SUMMARIES[(microbialRisk || "").toLowerCase()] || "Microbial risk data pending."}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.3em] ${microbialStyle.badge}`}>{microbialStyle.icon} {microbialRisk || "pending"}</span>
                      </div>
                      {Number.isFinite(microbialScore) && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs text-slate-500"><span>Composite risk score</span><span className="text-sm font-semibold text-slate-700">{microbialScore} / {microbialMaxScore}</span></div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400" style={{ width: `${Math.min(100, Math.max(5, (microbialScore / microbialMaxScore) * 100))}%` }} /></div>
                        </div>
                      )}
                      {possibleBacteria.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Possible bacteria</p>
                          <div className="mt-2 flex flex-wrap gap-2">{possibleBacteria.map((b) => <span key={b} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">{b}</span>)}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {detailItem.type === "water" && (
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="rounded-3xl border border-slate-200 bg-white p-6">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Sample context</p>
                        <div className="mt-4 space-y-2 text-sm text-slate-600">
                          <div className="flex items-center justify-between"><span>Source</span><span>{detailItem.raw?.source || "n/a"}</span></div>
                          <div className="flex items-center justify-between"><span>Color</span><span>{detailItem.raw?.color || "n/a"}</span></div>
                          <div className="flex items-center justify-between"><span>Label</span><span>{detailItem.raw?.sample_label || "n/a"}</span></div>
                          <div className="flex items-center justify-between"><span>Notes</span><span className="text-right">{detailItem.raw?.notes || "n/a"}</span></div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-slate-200 bg-white p-6">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Anomaly checks</p>
                        {checks.length ? (
                          <div className="mt-4 space-y-3">
                            {checks.map((check, index) => (
                              <div key={`${check.field || "check"}-${index}`} className={`rounded-xl border p-3 ${CHECK_STYLES[check.status] || "border-slate-200 bg-white text-slate-600"}`}>
                                <div className="flex items-center justify-between">
                                  <span className="flex items-center">
                                    <span className={`inline-block w-2 h-2 rounded-full mr-3 ${PARAMETER_COLORS[normalizeFieldKey(check.field || check.label)]?.dot || "bg-slate-300"}`} />
                                    <span className="font-semibold text-slate-900">{check.label || check.field || "Metric"}</span>
                                  </span>
                                  <span className="text-xs uppercase tracking-[0.3em]">{check.status || "ok"}</span>
                                </div>
                                <p className="mt-2 text-xs text-slate-500">Observed: {formatValue(check.value)}</p>
                                <p className="mt-1 text-xs text-slate-400">{check.detail || "No detail provided."}</p>
                                {check.recommended_range && <p className="mt-1 text-xs text-slate-400">Recommended: {formatValue(check.recommended_range?.[0])} - {formatValue(check.recommended_range?.[1])}</p>}
                                {typeof check.z_score === "number" && Number.isFinite(check.z_score) && <p className="mt-1 text-xs text-slate-400">Z-score {check.z_score.toFixed(2)}</p>}
                              </div>
                            ))}
                          </div>
                        ) : <p className="mt-3 text-sm text-slate-500">No anomaly checks available.</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}
    </section>
  );
}
