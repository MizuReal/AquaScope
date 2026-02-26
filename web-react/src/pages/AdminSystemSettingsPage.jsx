import { useState } from "react";

export default function AdminSystemSettingsPage() {
  const [settings, setSettings] = useState({
    maintenance: false,
    registration: true,
    ocr: true,
    predictions: true,
  });

  const handleToggle = (key) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const systemModules = [
    {
      label: "Maintenance Mode",
      key: "maintenance",
      detail: "Enable to restrict access to administrators only during system maintenance.",
      icon: "🔧",
    },
    {
      label: "User Registration",
      key: "registration",
      detail: "Allow new users to create accounts on the platform.",
      icon: "📝",
    },
    {
      label: "OCR Service",
      key: "ocr",
      detail: "Enable optical character recognition for water quality forms.",
      icon: "🔍",
    },
    {
      label: "ML Predictions",
      key: "predictions",
      detail: "Enable machine learning models for water potability predictions.",
      icon: "🧠",
    },
  ];

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">System Settings</p>
          <h1 className="text-3xl font-semibold text-slate-900">Platform Configuration</h1>
        </div>
        <button className="rounded-full border border-sky-200 bg-sky-50 px-5 py-2 text-sm text-sky-700 transition hover:bg-sky-100">
          Save Changes
        </button>
      </header>

      <div className="mt-10 space-y-6">
        {systemModules.map((module) => (
          <article
            key={module.key}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{module.icon}</span>
              <div className="space-y-1">
                <p className="text-base font-semibold text-slate-900">{module.label}</p>
                <p className="text-sm text-slate-500">{module.detail}</p>
              </div>
            </div>
            <button
              onClick={() => handleToggle(module.key)}
              className={`relative h-6 w-12 rounded-full transition ${
                settings[module.key] ? "bg-sky-500" : "bg-slate-300"
              }`}
              aria-label={`Toggle ${module.label}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                  settings[module.key] ? "right-0.5" : "left-0.5"
                }`}
              />
            </button>
          </article>
        ))}
      </div>

      <article className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Advanced Configuration</p>
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              API Rate Limit (requests/minute)
            </label>
            <input
              type="number"
              defaultValue={100}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Session Timeout (minutes)
            </label>
            <input
              type="number"
              defaultValue={60}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>
      </article>
    </section>
  );
}
