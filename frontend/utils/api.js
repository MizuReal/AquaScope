const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

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
 * Analyze a container image for moss classification.
 * Returns predicted_class, confidence, and per-class probabilities.
 */
export async function analyzeContainer(asset) {
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
    });
  } catch (networkError) {
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
