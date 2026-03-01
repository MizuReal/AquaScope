import UserSamples from "@/components/UserSamples";

export default function ScansPage() {
  // Auth is already verified by DashboardLayout — no redundant getSession() needed here.
  return (
    <section className="px-6 py-10 text-slate-900 lg:px-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">My scans</p>
          <h1 className="text-3xl font-semibold">Prediction history</h1>
          <p className="text-sm text-slate-500">All samples linked to your account.</p>
        </header>
        <UserSamples />
      </div>
    </section>
  );
}
