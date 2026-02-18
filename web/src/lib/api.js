const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const normalizeHistory = (history = []) =>
  history
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
    .map((item) => ({ role: item.role, text: item.text.trim() }))
    .filter((item) => item.text.length > 0)
    .slice(-20);

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
      `Network request failed while contacting ${API_BASE_URL}. Ensure backend is running and NEXT_PUBLIC_API_URL is correct. Details: ${networkError?.message || "unknown error"}`,
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

export { API_BASE_URL };
