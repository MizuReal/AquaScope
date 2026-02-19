"use client";

export default function SystemAnalyticsPage() {
  const analyticsCards = [
    {
      label: "Active Users",
      value: "Track user engagement",
      detail: "Monitor daily, weekly, and monthly active users across the platform.",
      icon: "👥",
    },
    {
      label: "API Usage",
      value: "Request metrics",
      detail: "View API endpoint usage, response times, and error rates.",
      icon: "📊",
    },
    {
      label: "Data Processing",
      value: "OCR & ML stats",
      detail: "Performance metrics for OCR extraction and ML prediction services.",
      icon: "⚙️",
    },
    {
      label: "Storage",
      value: "Database insights",
      detail: "Monitor database size, table growth, and query performance.",
      icon: "💾",
    },
  ];

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">System Analytics</p>
          <h1 className="text-3xl font-semibold text-slate-900">Platform Performance Insights</h1>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm text-slate-600">
          Real-time monitoring
        </span>
      </header>

      <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {analyticsCards.map((card) => (
          <article 
            key={card.label} 
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-sky-200"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{card.icon}</span>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">{card.label}</p>
            </div>
            <p className="text-lg font-semibold text-slate-900">{card.value}</p>
            <p className="text-xs leading-relaxed text-slate-500">{card.detail}</p>
          </article>
        ))}
      </div>

      <article className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-500">System Health</p>
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <span className="text-sm text-slate-700">Backend API</span>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-sm font-medium text-emerald-700">Operational</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <span className="text-sm text-slate-700">Database Connection</span>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-sm font-medium text-emerald-700">Connected</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <span className="text-sm text-slate-700">ML Models</span>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-sm font-medium text-emerald-700">Ready</span>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
