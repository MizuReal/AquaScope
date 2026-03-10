import { useState, useRef, useEffect } from "react";
import Lottie from "lottie-react";
import { useAuth } from "@/lib/AuthContext";
import { chatWithCopilot } from "@/lib/api";
import cuteRobotAnim from "@/assets/lottie/CuteRobot.json";
import aiAnim from "@/assets/lottie/AI.json";

const CHAT_TABS = { WATER: "water_quality", DATA: "my_data" };

const formatCopilotText = (text = "") =>
  String(text)
    .replace(/\r\n/g, "\n")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "\u2022 ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const IconBot = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v3" /><circle cx="9" cy="13" r="1" /><circle cx="15" cy="13" r="1" /><path d="M9 16h6" /></svg>
);
const IconWater = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M12 3s-6 6-6 10a6 6 0 0 0 12 0c0-4-6-10-6-10z" /></svg>
);
const IconData = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M4 19V5" /><rect x="6" y="11" width="3" height="8" rx="0.8" /><rect x="11" y="8" width="3" height="11" rx="0.8" /><rect x="16" y="5" width="3" height="14" rx="0.8" /></svg>
);
const IconSend = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4z" /></svg>
);
const IconClose = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M6 6l12 12" /><path d="M18 6l-12 12" /></svg>
);

export default function ChatbotWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [chatTab, setChatTab] = useState(CHAT_TABS.WATER);
  const scrollRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, chatLoading]);

  const displayName = user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "User";

  const openChat = () => { setOpen(true); setTimeout(() => setActive(true), 10); };
  const closeChat = () => { setActive(false); setTimeout(() => setOpen(false), 220); };

  const handleTabChange = (t) => {
    if (t === chatTab) return;
    setChatTab(t);
    setChatHistory([]);
    setChatInput("");
    setChatError("");
  };

  const handleSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    const next = [...chatHistory, { role: "user", text: msg }];
    setChatHistory(next);
    setChatInput("");
    setChatLoading(true);
    setChatError("");
    const ctx = chatTab === CHAT_TABS.WATER
      ? { focus: "water_quality", guidance: "Focus on water quality interpretation, filtration suggestions, risk-level explanation, and safe follow-up actions." }
      : { focus: "my_data", guidance: "Focus on the user's activity and trends, summarize what their dashboard metrics imply, and suggest next steps based on personal data.", user_name: displayName };
    try {
      const p = await chatWithCopilot({ source: "web-widget", context: ctx }, next, msg);
      setChatHistory((prev) => [...prev, { role: "assistant", text: p.reply || "No response received." }]);
    } catch (e) {
      const t = e?.message || "Unable to contact chatbot right now.";
      setChatError(t);
      setChatHistory((prev) => [...prev, { role: "assistant", text: `Error: ${t}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const promptSuggestions = chatTab === CHAT_TABS.WATER
    ? ["Explain safe pH and turbidity ranges.", "What filtration is best for microbial risk?", "How do I interpret risk levels?"]
    : ["Summarize my scan activity.", "What should I do next?", "Give me a quick action plan."];

  // Don't render for unauthenticated users
  if (!user) return null;

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          type="button"
          onClick={openChat}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border-2 border-sky-300 bg-white shadow-lg shadow-sky-200/50 transition-transform hover:scale-110 hover:shadow-xl hover:shadow-sky-300/40 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2"
          aria-label="Open AI chatbot"
          title="AquaScope Copilot"
        >
          <Lottie animationData={cuteRobotAnim} loop autoplay className="h-10 w-10" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className={`fixed bottom-6 right-6 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-2xl shadow-sky-200/30 transition-all duration-200 ${active ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"}`} style={{ maxHeight: "min(36rem, calc(100dvh - 4rem))" }}>
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-sky-100 bg-gradient-to-r from-sky-600 to-cyan-500 px-4 py-3">
            <div className="h-8 w-8 rounded-lg border border-white/20 bg-white/20 p-1">
              <Lottie animationData={aiAnim} loop autoplay className="h-full w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">AquaScope Copilot</p>
              <p className="truncate text-[11px] text-white/70">Hi {displayName}! How can I help?</p>
            </div>
            <button type="button" onClick={closeChat} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30" aria-label="Close chat">
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Tab selector */}
          <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <button type="button" className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${chatTab === CHAT_TABS.WATER ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-slate-100"}`} onClick={() => handleTabChange(CHAT_TABS.WATER)}>
              <IconWater className="h-3 w-3" />Water quality
            </button>
            <button type="button" className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${chatTab === CHAT_TABS.DATA ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-slate-100"}`} onClick={() => handleTabChange(CHAT_TABS.DATA)}>
              <IconData className="h-3 w-3" />My data
            </button>
          </div>

          {/* Suggestions */}
          <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 py-2">
            {promptSuggestions.map((s) => (
              <button key={s} type="button" className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600 transition hover:bg-sky-50 hover:text-sky-700" onClick={() => setChatInput(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3" style={{ minHeight: "12rem" }}>
            {chatHistory.length === 0 ? (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700"><IconBot className="h-3 w-3" /></span>
                <div className="rounded-xl rounded-tl-none border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <p className="font-medium">How can I help you today?</p>
                  <p className="mt-1 text-[11px] text-slate-500">{chatTab === CHAT_TABS.WATER ? "Ask about risk levels, filtration, or water parameters." : "Ask about your activity and recommendations."}</p>
                </div>
              </div>
            ) : chatHistory.map((m, i) => (
              <div key={`${m.role}-${i}`} className={`max-w-[88%] rounded-xl border px-3 py-2 text-xs ${m.role === "user" ? "ml-auto border-sky-300 bg-sky-100 text-slate-800" : "border-slate-200 bg-white text-slate-700"}`}>
                <div className="mb-0.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-400">{m.role === "user" ? <IconData className="h-2.5 w-2.5" /> : <IconBot className="h-2.5 w-2.5" />}{m.role === "user" ? "You" : "Copilot"}</div>
                <p className="whitespace-pre-line">{m.role === "assistant" ? formatCopilotText(m.text) : m.text}</p>
              </div>
            ))}
            {chatLoading && (
              <div className="max-w-[88%] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <div className="mb-0.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-400"><IconBot className="h-2.5 w-2.5" />Copilot</div>
                <div className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:120ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:240ms]" /><span className="ml-1 text-[10px] text-slate-400">Thinking...</span></div>
              </div>
            )}
          </div>

          {/* Error */}
          {chatError && <p className="mx-3 rounded-lg border border-rose-300 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">{chatError}</p>}

          {/* Input */}
          <div className="flex items-end gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
            <textarea
              className="min-h-[2.5rem] max-h-24 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none ring-sky-300 placeholder:text-slate-400 focus:ring"
              placeholder={chatTab === CHAT_TABS.WATER ? "Ask about water quality..." : "Ask about your data..."}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={chatLoading || !chatInput.trim()}
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${chatLoading || !chatInput.trim() ? "bg-slate-200 text-slate-400" : "bg-sky-600 text-white hover:bg-sky-700"}`}
              aria-label="Send message"
            >
              {chatLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              ) : (
                <IconSend className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
