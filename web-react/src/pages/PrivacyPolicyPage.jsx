import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16">
      <div className="mx-auto max-w-2xl">
        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="mb-8 flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-sky-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to site
        </button>

        {/* Header */}
        <div className="mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">AquaScope</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-500">Effective date: March 2026</p>
        </div>

        <div className="space-y-8 rounded-2xl border border-slate-200 bg-white px-8 py-10 text-sm leading-relaxed text-slate-700 shadow-sm">

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">1. About This Project</h2>
            <p>
              AquaScope is an academic capstone project developed to demonstrate the use of machine
              learning in predicting water quality risk and potability. It is not a commercial product.
              This policy describes how we handle any data you provide while using the platform.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">2. Information We Collect</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Email address and name when you register an account.</li>
              <li>Water quality measurements you submit for analysis.</li>
              <li>Container scan images you upload (processed server-side, not stored long-term).</li>
              <li>Basic usage logs for debugging purposes only.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">3. How We Use Your Information</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>To provide water risk predictions and potability analysis.</li>
              <li>To maintain your account and prediction history.</li>
              <li>For academic evaluation and demonstration purposes only.</li>
            </ul>
            <p className="mt-3">
              We do <strong>not</strong> sell, share, or distribute your data to third parties.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">4. Data Storage</h2>
            <p>
              Data is stored securely using Supabase (PostgreSQL). Authentication is handled via
              Supabase Auth with industry-standard encryption. We take reasonable precautions, but
              as a student project, we cannot guarantee enterprise-grade security standards.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">5. Your Rights</h2>
            <p>
              You may request deletion of your account and associated data at any time by contacting
              the development team. As this is an academic project, data may be wiped at the end of
              the academic term.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-slate-900">6. Contact</h2>
            <p>
              This project was developed by Kim Jensen Yebes, Jay Tabigue, Ryan Russel Antoniano,
              and Alsamuel Crueta as part of an academic requirement. For concerns, reach out through
              your institution's designated communication channels.
            </p>
          </section>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          &copy; 2026 AquaScope — Academic Project &middot;{" "}
          <a href="/terms" className="text-sky-500 hover:underline">Terms of Service</a>
        </p>
      </div>
    </div>
  );
}
