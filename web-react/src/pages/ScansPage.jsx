import UserSamples from "@/components/UserSamples";

export default function ScansPage() {
  // Auth is already verified by DashboardLayout — no redundant getSession() needed here.
  return (
    <section className="px-6 py-10 text-slate-900 lg:px-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.4em] text-sky-600">My scans</p>
          <h1 className="text-4xl font-semibold">Prediction history</h1>
          <p className="text-base text-slate-600">All samples linked to your account.</p>
        </header>
        <UserSamples />
      </div>
    </section>
  );
}
