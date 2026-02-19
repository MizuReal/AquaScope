"use client";

import { useState } from "react";

export default function AdminSettingsPage() {
  const [profile, setProfile] = useState({
    notifications: true,
    emailAlerts: true,
    securityAlerts: true,
  });

  const handleToggle = (key) => {
    setProfile((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">Admin Settings</p>
          <h1 className="text-3xl font-semibold text-slate-900">Personal Preferences</h1>
        </div>
      </header>

      <div className="mt-10 max-w-3xl space-y-6">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-6 text-xs uppercase tracking-[0.35em] text-slate-500">Profile Information</p>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Display Name
              </label>
              <input
                type="text"
                defaultValue="Administrator"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Email Address
              </label>
              <input
                type="email"
                defaultValue="admin@aquascope.com"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-6 text-xs uppercase tracking-[0.35em] text-slate-500">Notification Preferences</p>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Push Notifications</p>
                <p className="text-xs text-slate-500">Receive notifications in the admin panel</p>
              </div>
              <button
                onClick={() => handleToggle("notifications")}
                className={`relative h-6 w-12 rounded-full transition ${
                  profile.notifications ? "bg-sky-500" : "bg-slate-300"
                }`}
                aria-label="Toggle push notifications"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                    profile.notifications ? "right-0.5" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Email Alerts</p>
                <p className="text-xs text-slate-500">Get email updates for important events</p>
              </div>
              <button
                onClick={() => handleToggle("emailAlerts")}
                className={`relative h-6 w-12 rounded-full transition ${
                  profile.emailAlerts ? "bg-sky-500" : "bg-slate-300"
                }`}
                aria-label="Toggle email alerts"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                    profile.emailAlerts ? "right-0.5" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Security Alerts</p>
                <p className="text-xs text-slate-500">Critical security notifications</p>
              </div>
              <button
                onClick={() => handleToggle("securityAlerts")}
                className={`relative h-6 w-12 rounded-full transition ${
                  profile.securityAlerts ? "bg-sky-500" : "bg-slate-300"
                }`}
                aria-label="Toggle security alerts"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                    profile.securityAlerts ? "right-0.5" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-6 text-xs uppercase tracking-[0.35em] text-slate-500">Security</p>
          <div className="space-y-3">
            <button className="w-full rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm text-sky-700 transition hover:bg-sky-100">
              Change Password
            </button>
            <button className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50">
              Two-Factor Authentication
            </button>
            <button className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50">
              Active Sessions
            </button>
          </div>
        </article>

        <div className="flex justify-end gap-3">
          <button className="rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
            Cancel
          </button>
          <button className="rounded-full border border-sky-200 bg-sky-500 px-6 py-2.5 text-sm text-white transition hover:bg-sky-600">
            Save Changes
          </button>
        </div>
      </div>
    </section>
  );
}
