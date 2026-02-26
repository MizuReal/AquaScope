const API_BASE_URL = (import.meta.env.VITE_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

const normalizeHistory = (history = []) =>
  history
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
    .map((item) => ({ role: item.role, text: item.text.trim() }))
    .filter((item) => item.text.length > 0)
    .slice(-20);

const CONTAINER_CLASS_RISK_MAP = {
  Clean: { level: "low", score: 1, status: "ok" },
  LightMoss: { level: "medium", score: 5, status: "warning" },
  MediumMoss: { level: "high", score: 9, status: "critical" },
  HeavyMoss: { level: "high", score: 12, status: "critical" },
};

const CONTAINER_CLASS_DISPLAY = {
  Clean: "Clean",
  LightMoss: "Light moss",
  MediumMoss: "Medium moss",
  HeavyMoss: "Heavy moss",
};

function resolveTopContainerClass(analysis = {}) {
  const probabilities = analysis?.probabilities;
  if (probabilities && typeof probabilities === "object") {
    const candidates = ["Clean", "LightMoss", "MediumMoss", "HeavyMoss"];
    let bestClass = null;
    let bestScore = -1;

    for (const className of candidates) {
      const score = Number(probabilities[className]);
      if (Number.isFinite(score) && score > bestScore) {
        bestClass = className;
        bestScore = score;
      }
    }

    if (bestClass) {
      return bestClass;
    }
  }

  const reportedClass = analysis?.predicted_class || analysis?.predictedClass;
  if (reportedClass && reportedClass !== "Unknown") {
    return reportedClass;
  }

  return "Unknown";
}

function buildContainerContextPrompt(topClass) {
  const label = CONTAINER_CLASS_DISPLAY[topClass] || topClass || "Unknown";
  return `How to clean a container with classification "${label}".`;
}

function buildLegacyWaterCompatibleContainerAnalysis(analysis = {}) {
  const topClass = resolveTopContainerClass(analysis);
  const mapped = CONTAINER_CLASS_RISK_MAP[topClass] || { level: "medium", score: 7, status: "warning" };
  const classificationPrompt = buildContainerContextPrompt(topClass);

  return {
    ...analysis,
    predicted_class: topClass,
    predictedClass: topClass,
    classificationPrompt,
    microbialRiskLevel: mapped.level,
    microbialScore: mapped.score,
    microbialMaxScore: 14,
    checks: [
      {
        field: "container_classification",
        label: "Container classification",
        status: mapped.status,
        value: null,
        detail: `Detected class: ${topClass}. ${classificationPrompt}`,
      },
    ],
    isPotable: false,
  };
}

export async function chatWithCopilot(analysis, history, message) {
  const trimmed = String(message || "").trim();
  if (!trimmed) {
    throw new Error("Message cannot be empty.");
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/chat/message`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        analysis: analysis || {},
        history: normalizeHistory(history),
        message: trimmed,
      }),
    });
  } catch (networkError) {
    throw new Error(
      `Network request failed while contacting ${API_BASE_URL}. Ensure backend is running and VITE_PUBLIC_API_URL is correct. Details: ${networkError?.message || "unknown error"}`,
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("AI rate limit reached — please wait a moment and retry.");
    }
    throw new Error(payload?.detail || payload?.message || "Chat request failed.");
  }

  return payload;
}

export async function getContainerCleaningSuggestion(analysis) {
  const legacyAnalysis = buildLegacyWaterCompatibleContainerAnalysis(analysis);
  const topClass = resolveTopContainerClass(analysis);
  const topClassPrompt = buildContainerContextPrompt(topClass);
  const containerAnalysis = {
    ...analysis,
    predicted_class: topClass,
    predictedClass: topClass,
    classificationPrompt: topClassPrompt,
  };

  let response = await fetch(`${API_BASE_URL}/chat/container-suggestion`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ analysis: containerAnalysis }),
  });

  if (response.status === 404) {
    response = await fetch(`${API_BASE_URL}/chat/filtration-suggestion`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: legacyAnalysis }),
    });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 429) {
      throw new Error("AI rate limit reached — please wait a moment and retry.");
    }
    throw new Error(payload?.detail || "Container cleaning suggestion failed.");
  }

  return response.json();
}

export async function exportAnalyticsPdf(payload) {
  const response = await fetch(`${API_BASE_URL}/export/analytics-pdf`, {
    method: "POST",
    headers: {
      Accept: "application/pdf",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const maybeJson = await response.json().catch(() => ({}));
    throw new Error(maybeJson?.detail || "Unable to export analytics PDF.");
  }

  return response.blob();
}

export async function sendUserDeactivationEmail({ targetUserId, adminUserId, reason, accessToken }) {
  const response = await fetch(`${API_BASE_URL}/admin/notify-user-deactivated`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      target_user_id: targetUserId,
      admin_user_id: adminUserId,
      reason,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || "Unable to send deactivation email.");
  }

  return payload;
}

export { API_BASE_URL };
