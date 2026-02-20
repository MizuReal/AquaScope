const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const CONTAINER_CLASS_RISK_MAP = {
  Clean: { level: 'low', score: 1, status: 'ok' },
  LightMoss: { level: 'medium', score: 5, status: 'warning' },
  MediumMoss: { level: 'high', score: 9, status: 'critical' },
  HeavyMoss: { level: 'high', score: 12, status: 'critical' },
};

const CONTAINER_CLASS_DISPLAY = {
  Clean: 'Clean',
  LightMoss: 'Light moss',
  MediumMoss: 'Medium moss',
  HeavyMoss: 'Heavy moss',
};

function resolveTopContainerClass(analysis = {}) {
  const probs = analysis?.probabilities;
  if (probs && typeof probs === 'object') {
    const candidates = ['Clean', 'LightMoss', 'MediumMoss', 'HeavyMoss'];
    let bestClass = null;
    let bestScore = -1;

    for (const cls of candidates) {
      const raw = Number(probs[cls]);
      if (Number.isFinite(raw) && raw > bestScore) {
        bestClass = cls;
        bestScore = raw;
      }
    }

    if (bestClass) {
      return bestClass;
    }
  }

  const reported = analysis?.predicted_class || analysis?.predictedClass;
  if (reported && reported !== 'Unknown') {
    return reported;
  }

  return 'Unknown';
}

function buildContainerContextPrompt(topClass) {
  const label = CONTAINER_CLASS_DISPLAY[topClass] || topClass || 'Unknown';
  return `How to clean a container with classification \"${label}\".`;
}

function buildLegacyWaterCompatibleContainerAnalysis(analysis = {}) {
  const cls = resolveTopContainerClass(analysis);
  const mapped = CONTAINER_CLASS_RISK_MAP[cls] || { level: 'medium', score: 7, status: 'warning' };
  const classificationPrompt = buildContainerContextPrompt(cls);

  return {
    ...analysis,
    predicted_class: cls,
    predictedClass: cls,
    classificationPrompt,
    microbialRiskLevel: mapped.level,
    microbialScore: mapped.score,
    microbialMaxScore: 14,
    checks: [
      {
        field: 'container_classification',
        label: 'Container classification',
        status: mapped.status,
        value: null,
        detail: `Detected class: ${cls}. ${classificationPrompt}`,
      },
    ],
    isPotable: false,
  };
}

export async function uploadDataCardForOCR(asset) {
  if (!asset) {
    throw new Error('No image asset supplied for OCR');
  }

  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    name: asset.fileName || `data-card-${Date.now()}.jpg`,
    type: asset.mimeType || 'image/jpeg',
  });

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/ocr/data-card`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    });
  } catch (networkError) {
    throw new Error(
      `Network request failed while contacting ${API_BASE_URL}. ` +
        'Ensure the backend is running and EXPO_PUBLIC_API_URL matches that host. ' +
        `Details: ${networkError?.message || 'unknown error'}`,
    );
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      message ||
        `OCR service responded with ${response.status}. Verify the backend logs for /ocr/data-card.`,
    );
  }

  return response.json();
}

/**
 * Validate fiducial markers in an image for real-time capture guidance.
 * This is a lightweight endpoint optimized for repeated calls during camera preview.
 * 
 * @param {Object} asset - Image asset with uri property
 * @returns {Promise<{detected: number, corners: Object, quality: number, ready: boolean}>}
 */
export async function validateFiducials(asset) {
  if (!asset?.uri) {
    throw new Error('No image asset supplied for fiducial validation');
  }

  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    name: asset.fileName || `fiducial-check-${Date.now()}.jpg`,
    type: asset.mimeType || 'image/jpeg',
  });

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/fiducial/validate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    });
  } catch (networkError) {
    // Silently fail for validation - it's not critical
    console.debug('[fiducial] Network error during validation:', networkError?.message);
    return { detected: 0, corners: {}, quality: 0, ready: false };
  }

  if (!response.ok) {
    console.debug('[fiducial] Validation failed with status:', response.status);
    return { detected: 0, corners: {}, quality: 0, ready: false };
  }

  return response.json();
}

export async function submitWaterSample(sample) {
  const response = await fetch(`${API_BASE_URL}/predict/potability`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sample),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.detail || payload?.message;
    throw new Error(detail || 'Unable to submit water sample.');
  }

  return response.json();
}

/**
 * Standalone microbial-risk assessment.
 * Can be called independently or the result is already included
 * in the potability response.
 */
export async function assessMicrobialRisk(sample) {
  const response = await fetch(`${API_BASE_URL}/predict/microbial-risk`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sample),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.detail || payload?.message;
    throw new Error(detail || 'Unable to assess microbial risk.');
  }

  return response.json();
}

/**
 * One-shot: get a Gemini-powered filtration suggestion for the given analysis.
 */
export async function getFiltrationSuggestion(analysis) {
  const response = await fetch(`${API_BASE_URL}/chat/filtration-suggestion`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 429) {
      throw new Error('AI rate limit reached — please wait a moment and retry.');
    }
    throw new Error(payload?.detail || 'Filtration suggestion failed.');
  }
  return response.json();
}

/**
 * Multi-turn chat with Gemini, grounded in the water analysis context.
 */
export async function chatWithGemini(analysis, history, message) {
  const response = await fetch(`${API_BASE_URL}/chat/message`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis, history, message }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.detail || 'Chat request failed.');
  }
  return response.json();
}

/**
 * One-shot: get container cleaning/discard guidance from container analysis.
 */
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
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis: containerAnalysis }),
  });

  // Backward compatibility: older backends may not expose container-specific routes yet.
  // Fallback to the existing water suggestion endpoint used by WaterResultScreen.
  if (response.status === 404) {
    response = await fetch(`${API_BASE_URL}/chat/filtration-suggestion`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis: legacyAnalysis }),
    });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 429) {
      throw new Error('AI rate limit reached — please wait a moment and retry.');
    }
    throw new Error(payload?.detail || 'Container cleaning suggestion failed.');
  }
  return response.json();
}

/**
 * Multi-turn container hygiene chat grounded in classification context.
 */
export async function chatContainerWithGemini(analysis, history, message) {
  const legacyAnalysis = buildLegacyWaterCompatibleContainerAnalysis(analysis);
  const topClass = resolveTopContainerClass(analysis);
  const topClassPrompt = buildContainerContextPrompt(topClass);
  const containerAnalysis = {
    ...analysis,
    predicted_class: topClass,
    predictedClass: topClass,
    classificationPrompt: topClassPrompt,
  };
  const contextualMessage = `${topClassPrompt} User question: ${message}`;

  let response = await fetch(`${API_BASE_URL}/chat/container-message`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis: containerAnalysis, history, message: contextualMessage }),
  });

  // Backward compatibility with existing backend chat route.
  if (response.status === 404) {
    response = await fetch(`${API_BASE_URL}/chat/message`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis: legacyAnalysis, history, message: contextualMessage }),
    });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.detail || 'Container chat request failed.');
  }
  return response.json();
}

/**
 * Analyze a container image for moss classification.
 * Returns predicted_class, confidence, and per-class probabilities.
 */
export async function analyzeContainer(asset, signal) {
  if (!asset?.uri) {
    throw new Error('No image asset supplied for container analysis');
  }

  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    name: asset.fileName || `container-${Date.now()}.jpg`,
    type: asset.mimeType || 'image/jpeg',
  });

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/container/analyze`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
      signal,
    });
  } catch (networkError) {
    // AbortError is intentional (a newer request superseded this one) — swallow it
    if (networkError?.name === 'AbortError') {
      throw networkError;
    }
    throw new Error(
      `Network error contacting ${API_BASE_URL}. ` +
        `Details: ${networkError?.message || 'unknown'}`,
    );
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Container analysis failed (${response.status})`);
  }

  return response.json();
}

export { API_BASE_URL };
