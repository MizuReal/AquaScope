import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/AuthContext";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import {
  analyzeContainer,
  chatContainerWithCopilot,
  getContainerCleaningSuggestion,
} from "@/lib/api";

/* ── Constants ──────────────────────────────────────────────── */

const CONTAINER_SCANS_TABLE =
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE || "container_scans";
const CONTAINER_SCAN_BUCKET =
  import.meta.env.VITE_PUBLIC_SUPABASE_CONTAINER_SCAN_BUCKET || "container-scans";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/* ── Class metadata ─────────────────────────────────────────── */

const CLASS_META = {
  Clean: {
    color: "#22c55e",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    label: "Clean",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    severity: "safe",
  },
  LightMoss: {
    color: "#facc15",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    text: "text-yellow-700",
    label: "Light Moss",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    severity: "low",
  },
  MediumMoss: {
    color: "#f97316",
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
    label: "Medium Moss",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    severity: "moderate",
  },
  HeavyMoss: {
    color: "#ef4444",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    label: "Heavy Moss",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    severity: "high",
  },
  Unknown: {
    color: "#64748b",
    bg: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-600",
    label: "Not Recognized",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    severity: "unknown",
  },
};

const SEVERITY_BADGE = {
  safe: { label: "Safe", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  low: { label: "Low Risk", classes: "border-yellow-200 bg-yellow-50 text-yellow-700" },
  moderate: { label: "Moderate", classes: "border-orange-200 bg-orange-50 text-orange-700" },
  high: { label: "High Risk", classes: "border-red-200 bg-red-50 text-red-700" },
  unknown: { label: "Unknown", classes: "border-slate-200 bg-slate-100 text-slate-600" },
};

const severityNote = (cls, isValid) => {
  if (!isValid)
    return "The image could not be confidently classified. Ensure the photo clearly shows the container surface and try again.";
  switch (cls) {
    case "Clean":
      return "Container surface is clean — no biological growth detected.";
    case "LightMoss":
      return "Minor biological growth observed. Consider routine cleaning.";
    case "MediumMoss":
      return "Moderate moss/algae build-up. Cleaning is recommended before next use.";
    case "HeavyMoss":
      return "Significant contamination detected. Immediate cleaning or replacement advised.";
    default:
      return "";
  }
};

const formatAdvisorText = (text = "") => {
  if (!text) return "";
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const CAPTURE_TIPS = [
  { icon: "☀️", text: "Shoot in natural light or a brightly lit area" },
  { icon: "🔲", text: "Fill the frame with the container surface" },
  { icon: "💧", text: "Dry the surface before photographing when possible" },
  { icon: "🔄", text: "Retake if the image is blurry or poorly lit" },
];

/* ── Confidence Bar ─────────────────────────────────────────── */

function ConfidenceBar({ label, value, color }) {
  const pct = Math.round(value * 100);
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="text-xs font-bold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* ── Container Advisor Chat ─────────────────────────────────── */

function ContainerAdvisorCard({ result }) {
  const [suggestion, setSuggestion] = useState(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!result?.is_valid) {
      setSuggestion(null);
      setSuggestionError("");
      setSuggestionLoading(false);
      setChatHistory([]);
      return;
    }
    let cancelled = false;
    setSuggestion(null);
    setSuggestionError("");
    setSuggestionLoading(true);
    setChatHistory([]);

    getContainerCleaningSuggestion(result)
      .then((res) => {
        if (!cancelled) setSuggestion(res?.suggestion || "No suggestion available.");
      })
      .catch((err) => {
        if (!cancelled) setSuggestionError(err?.message || "Failed to get cleaning advice.");
      })
      .finally(() => {
        if (!cancelled) setSuggestionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  const handleSend = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading || !result?.is_valid) return;

    const nextHistory = [...chatHistory, { role: "user", text: trimmed }];
    setChatHistory(nextHistory);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await chatContainerWithCopilot(result, nextHistory, trimmed);
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: response?.reply || "No reply." },
      ]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${err?.message || "Request failed"}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatHistory, chatInput, chatLoading, result]);

  const classLabel =
    CLASS_META[result?.predicted_class || "Unknown"]?.label ||
    result?.predicted_class ||
    "Unknown";

  const sendEnabled = Boolean(result?.is_valid) && !chatLoading && chatInput.trim().length > 0;

  const retrySuggestion = () => {
    setSuggestionError("");
    setSuggestionLoading(true);
    getContainerCleaningSuggestion(result)
      .then((res) => setSuggestion(res?.suggestion || "No suggestion available."))
      .catch((err) => setSuggestionError(err?.message || "Failed to get cleaning advice."))
      .finally(() => setSuggestionLoading(false));
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8" />
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <path d="M2 12h20" />
            <path d="M12 2v20" />
          </svg>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-700">
            Container advisor
          </span>
        </div>
        <span className="rounded-full border border-sky-200 px-2 py-0.5 text-[9px] font-semibold text-sky-700">
          AI
        </span>
      </div>

      <p className="mb-3 text-[11px] text-slate-500">Based on class: {classLabel}</p>

      {/* Suggestion */}
      {suggestionLoading ? (
        <div className="flex flex-col items-center py-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          <p className="mt-2 text-[11px] text-slate-500">Generating cleaning guidance...</p>
        </div>
      ) : suggestionError ? (
        <div>
          <p className="text-[11px] text-red-600">{suggestionError}</p>
          <button
            type="button"
            onClick={retrySuggestion}
            className="mt-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100"
          >
            Retry
          </button>
        </div>
      ) : suggestion ? (
        <p className="whitespace-pre-line text-xs leading-relaxed text-slate-700">
          {formatAdvisorText(suggestion)}
        </p>
      ) : null}

      {/* Chat trigger */}
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs text-slate-500 transition hover:bg-slate-100"
      >
        Ask how to clean, disinfect, or when to discard this container...
      </button>

      {/* Chat modal */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-sky-200 bg-white shadow-xl">
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Container Copilot</h3>
                <p className="text-xs text-slate-500">Cleaning & disposal assistant</p>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-sm font-bold text-slate-600 transition hover:bg-slate-100"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>

            {/* Chat body */}
            <div className="flex-1 overflow-y-auto px-5 py-4" style={{ maxHeight: "50vh" }}>
              {chatHistory.length === 0 && (
                <p className="py-3 text-[11px] text-slate-500">
                  Ask for step-by-step cleaning and whether this container should be kept or replaced.
                </p>
              )}
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`mb-2 max-w-[85%] rounded-2xl border px-4 py-3 ${
                    msg.role === "user"
                      ? "ml-auto border-sky-200 bg-sky-50"
                      : "mr-auto border-slate-200 bg-slate-50"
                  }`}
                >
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-800">
                    {msg.role === "assistant" ? formatAdvisorText(msg.text) : msg.text}
                  </p>
                </div>
              ))}
              {chatLoading && (
                <div className="mr-auto flex items-center gap-2 px-3 py-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                  <span className="text-[10px] text-sky-500">Thinking...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="flex items-end gap-3 border-t border-slate-100 px-5 py-4">
              <textarea
                className="max-h-20 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="Ask about cleaning steps..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={chatLoading}
                rows={1}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!sendEnabled}
                className={`rounded-2xl px-4 py-3 text-[13px] font-semibold transition ${
                  sendEnabled
                    ? "border border-sky-400 bg-sky-500 text-white hover:bg-sky-600"
                    : "bg-slate-200 text-slate-400"
                }`}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Webcam Capture Component ───────────────────────────────── */

function WebcamCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (isMounted) setReady(true);
          };
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err.name === "NotAllowedError"
              ? "Camera access was denied. Please allow camera permissions and try again."
              : err.name === "NotFoundError"
                ? "No camera detected on this device."
                : `Camera error: ${err.message}`,
          );
        }
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `container-${Date.now()}.jpg`, { type: "image/jpeg" });
          streamRef.current?.getTracks().forEach((t) => t.stop());
          onCapture(file, URL.createObjectURL(blob));
        }
      },
      "image/jpeg",
      0.85,
    );
  };

  const handleClose = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-sm font-semibold text-slate-900">Camera capture</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-sm font-bold text-slate-500 transition hover:bg-slate-100"
            aria-label="Close camera"
          >
            ✕
          </button>
        </div>

        <div className="relative bg-black">
          {error ? (
            <div className="flex min-h-[320px] items-center justify-center px-6 text-center">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full"
                style={{ maxHeight: "60vh" }}
              />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                </div>
              )}
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCapture}
            disabled={!ready || !!error}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              ready && !error
                ? "bg-sky-500 text-white hover:bg-sky-600"
                : "bg-slate-200 text-slate-400"
            }`}
          >
            Take photo
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────── */

export default function ContainerScanPage() {
  const { user } = useAuth();
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // Clean up preview URLs on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /* ── Supabase persistence ─────────────────────────────────── */

  const uploadAndPersist = useCallback(
    async (analysis, file) => {
      if (!supabase || !isSupabaseConfigured || !user?.id || !analysis || !file) return;

      let imageUrl = null;
      try {
        const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from(CONTAINER_SCAN_BUCKET)
          .upload(filePath, file, { contentType: file.type || "image/jpeg" });

        if (!uploadError) {
          const { data } = supabase.storage.from(CONTAINER_SCAN_BUCKET).getPublicUrl(filePath);
          imageUrl = data?.publicUrl || null;
        } else {
          console.warn("[Supabase] container image upload failed:", uploadError.message);
        }
      } catch (err) {
        console.warn("[Supabase] container image upload error:", err?.message);
      }

      const record = {
        user_id: user.id,
        predicted_class: analysis?.predicted_class || "Unknown",
        confidence: Number.isFinite(analysis?.confidence) ? analysis.confidence : null,
        is_valid: Boolean(analysis?.is_valid),
        rejection_reason: analysis?.rejection_reason || null,
        entropy: Number.isFinite(analysis?.entropy) ? analysis.entropy : null,
        margin: Number.isFinite(analysis?.margin) ? analysis.margin : null,
        probabilities:
          analysis?.probabilities && typeof analysis.probabilities === "object"
            ? analysis.probabilities
            : {},
        image_uri: imageUrl,
      };

      const { error: insertError } = await supabase.from(CONTAINER_SCANS_TABLE).insert(record);
      if (insertError) {
        console.warn("[Supabase] container scan insert failed:", insertError.message);
      }
    },
    [user?.id],
  );

  /* ── Core analysis flow ──────────────────────────────────── */

  const runAnalysis = useCallback(
    async (file, preview) => {
      setImageFile(file);
      setPreviewUrl(preview);
      setResult(null);
      setLoading(true);
      setError("");

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const analysis = await analyzeContainer(file, controller.signal);
        setResult(analysis);
        // Fire-and-forget Supabase persistence
        uploadAndPersist(analysis, file).catch(() => {});
      } catch (err) {
        if (err?.name !== "AbortError") {
          setError(err.message || "Analysis failed.");
        }
      } finally {
        setLoading(false);
      }
    },
    [uploadAndPersist],
  );

  /* ── File validation ──────────────────────────────────────── */

  const validateAndRun = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type?.startsWith("image/")) {
        setError("Please select an image file (JPEG, PNG, WebP, etc.).");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("Image exceeds 10 MB limit. Please use a smaller file.");
        return;
      }
      const preview = URL.createObjectURL(file);
      runAnalysis(file, preview);
    },
    [runAnalysis],
  );

  /* ── Drag-and-drop handlers ──────────────────────────────── */

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    validateAndRun(file);
  };

  /* ── File input handler ──────────────────────────────────── */

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    validateAndRun(file);
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /* ── Webcam capture handler ──────────────────────────────── */

  const handleWebcamCapture = (file, preview) => {
    setWebcamOpen(false);
    runAnalysis(file, preview);
  };

  /* ── Reset ────────────────────────────────────────────────── */

  const handleReset = () => {
    abortRef.current?.abort();
    setImageFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    setLoading(false);
    setError("");
  };

  /* ── Derived display data ─────────────────────────────────── */

  const topClass = result?.predicted_class || "Unknown";
  const isValid = result?.is_valid ?? false;
  const meta = CLASS_META[topClass] || CLASS_META.Unknown;
  const badge = SEVERITY_BADGE[meta.severity];
  const probabilities = result?.probabilities ?? {};

  return (
    <section className="px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        {/* ── Page header ─────────────────────────────────────── */}
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Container analysis</p>
          <h1 className="text-3xl font-semibold">Moss & Algae Detection</h1>
          <p className="text-sm text-slate-500">
            Upload or capture a photo of your water container to classify biological growth and get
            AI-powered cleaning recommendations.
          </p>
        </header>

        {/* ── Info strip ──────────────────────────────────────── */}
        <div className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-xs leading-relaxed text-sky-800">
            Photograph the container surface in good lighting for the most accurate classification.
            The model recognizes four states: Clean, Light Moss, Medium Moss, and Heavy Moss.
          </p>
        </div>

        {/* ── Capture card ────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-600">
              Capture
            </span>
          </div>

          <div className="space-y-4 px-5 py-5">
            {/* Preview */}
            {previewUrl && (
              <div className="relative overflow-hidden rounded-2xl border border-slate-200" style={{ maxHeight: 320 }}>
                <img
                  src={previewUrl}
                  alt="Selected container"
                  className="h-full w-full object-cover"
                  style={{ maxHeight: 320 }}
                />
                <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-black/45 px-3 py-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-sky-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span className="text-[11px] text-sky-100">
                    {imageFile?.name || "Captured image"}
                  </span>
                </div>
              </div>
            )}

            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition-colors ${
                dragActive
                  ? "border-sky-400 bg-sky-50"
                  : "border-slate-300 bg-slate-50 hover:border-sky-300 hover:bg-sky-50/50"
              } ${loading ? "pointer-events-none opacity-50" : ""}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="mb-3 h-8 w-8 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-sm font-medium text-slate-600">
                {previewUrl ? "Drop a new image or click to replace" : "Drag & drop a container image here"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                or click to browse · JPEG, PNG, WebP · max 10 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Select container image"
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setWebcamOpen(true)}
                disabled={loading}
                className={`flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 ${
                  loading ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Use webcam
              </button>

              {previewUrl && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Reset
                </button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Analysis result card ────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="20" x2="20" y2="20" />
              <rect x="6" y="11" width="3" height="7" rx="0.8" />
              <rect x="11" y="8" width="3" height="10" rx="0.8" />
              <rect x="16" y="5" width="3" height="13" rx="0.8" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-600">
              Analysis snapshot
            </span>
          </div>

          <div className="px-5 py-5">
            {/* Loading */}
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-sky-200 bg-sky-50">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                </div>
                <p className="text-sm font-medium text-sky-700">Running moss classification…</p>
                <p className="text-[11px] text-slate-500">This may take a few seconds</p>
              </div>

            ) : previewUrl && result ? (
              <div className="space-y-4">
                {/* Verdict row */}
                <div className="flex gap-4">
                  {/* Thumbnail */}
                  <div className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl border border-slate-200">
                    <img src={previewUrl} alt="Scanned container" className="h-full w-full object-cover" />
                  </div>

                  {/* Verdict info */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
                      >
                        {meta.icon}
                      </div>
                      <span className="text-[15px] font-bold text-slate-900">{meta.label}</span>
                      {isValid && badge && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.classes}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>

                    {isValid && (
                      <>
                        <div className="flex items-center gap-1.5">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="20" x2="18" y2="10" />
                            <line x1="12" y1="20" x2="12" y2="4" />
                            <line x1="6" y1="20" x2="6" y2="14" />
                          </svg>
                          <span className="text-xs font-semibold text-slate-600">
                            {Math.round(result.confidence * 100)}% confidence
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-400">
                            Entropy {result.entropy ?? "–"} · Margin{" "}
                            {result.margin != null ? `${Math.round(result.margin * 100)}%` : "–"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Rejection banner */}
                {!isValid && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <p className="text-xs leading-relaxed text-amber-800">
                        {result?.rejection_reason || "Image not recognized as a container"}
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 8V4H8" />
                        <rect x="2" y="2" width="20" height="20" rx="5" />
                        <path d="M2 12h20" />
                        <path d="M12 2v20" />
                        <line x1="2" y1="2" x2="22" y2="22" />
                      </svg>
                      <p className="text-xs leading-relaxed text-slate-600">
                        AI advisor is unavailable until a valid container is recognized.
                      </p>
                    </div>
                  </div>
                )}

                {/* Severity note */}
                {severityNote(topClass, isValid) && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <p className="text-xs leading-relaxed text-sky-800">
                      {severityNote(topClass, isValid)}
                    </p>
                  </div>
                )}

                {/* Combine data note */}
                {isValid && (
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span className="text-[11px] text-slate-400">
                      Combine with pH, turbidity and nutrient data for a full assessment.
                    </span>
                  </div>
                )}

                {/* Confidence breakdown */}
                {isValid && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="4" y1="20" x2="20" y2="20" />
                        <rect x="6" y="11" width="3" height="7" rx="0.8" />
                        <rect x="11" y="8" width="3" height="10" rx="0.8" />
                        <rect x="16" y="5" width="3" height="13" rx="0.8" />
                      </svg>
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-600">
                        Confidence breakdown
                      </span>
                    </div>
                    {Object.entries(CLASS_META)
                      .filter(([cls]) => cls !== "Unknown")
                      .map(([cls, { color, label }]) => (
                        <ConfidenceBar
                          key={cls}
                          label={label}
                          value={probabilities[cls] ?? 0}
                          color={color}
                        />
                      ))}
                  </div>
                )}

                {/* AI advisor */}
                {isValid && <ContainerAdvisorCard result={result} />}
              </div>

            ) : previewUrl && !result ? (
              <div className="flex items-center gap-3 py-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <rect x="3" y="3" width="7" height="7" rx="2" ry="2" />
                </svg>
                <p className="text-sm text-slate-500">Image captured. Waiting for analysis results…</p>
              </div>

            ) : (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                    <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <line x1="9" y1="12" x2="15" y2="12" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-500">No image analyzed yet</p>
                <p className="max-w-[280px] text-center text-xs leading-relaxed text-slate-400">
                  Capture or upload a photo to see moss/algae classification results and confidence
                  scores.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Tips card ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-700">
              Capture tips
            </span>
          </div>
          {CAPTURE_TIPS.map((tip) => (
            <div key={tip.text} className="mb-2.5 flex items-start gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-xs">
                {tip.icon}
              </span>
              <p className="flex-1 text-xs leading-relaxed text-slate-600">{tip.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Webcam modal */}
      {webcamOpen && (
        <WebcamCapture
          onCapture={handleWebcamCapture}
          onClose={() => setWebcamOpen(false)}
        />
      )}
    </section>
  );
}
