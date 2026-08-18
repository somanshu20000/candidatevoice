import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Legal & Privacy | CandidateVoice",
  description: "How CandidateVoice handles data, privacy, and grievances.",
};

/**
 * Scaffold, not final copy. Every sentence below maps to a real, tested
 * invariant already enforced in code (see DECISIONS.md D-001 through D-029)
 * — that's what makes it safe for an engineer to draft. The bracketed
 * placeholders are the one part an engineer must not fabricate: India's IT
 * Rules 2021 require a NAMED individual and a real registered contact
 * channel, not a generic inbox. Same shape as VERIFICATION_SECRET elsewhere
 * in this codebase — the scaffold is ready, a human supplies the one piece
 * only they can supply. Do not link this prominently from the site until
 * the placeholders are filled with real, confirmed content.
 */
export default function LegalPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-16 w-full flex-1">
        <h1 className="font-serif text-3xl text-ink mb-2">Legal &amp; Privacy</h1>
        <p className="text-sm text-ink-muted mb-10">Last reviewed: [DATE — update on every real change to this page]</p>

        <section className="mb-10">
          <h2 className="font-serif text-xl text-ink mb-3">What we collect</h2>
          <div className="text-sm text-ink-soft leading-relaxed space-y-3">
            <p>
              We never ask for or store your name, email, or any contact detail. There is no
              account, and nothing in our data ties a report back to a specific person.
            </p>
            <p>
              Every question on the submission form is a closed choice — a dropdown, a fixed
              set of options — never a free-text field where a name or identifying detail
              could be typed in by accident.
            </p>
            <p>
              Dates are coarsened to the month before anything is shown publicly. A report
              can never be pinned to the exact day it was submitted.
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="font-serif text-xl text-ink mb-3">How reports become public</h2>
          <div className="text-sm text-ink-soft leading-relaxed space-y-3">
            <p>
              A human reviews every submission before it is published. Nothing you submit
              appears on the site automatically.
            </p>
            <p>
              At a small company, a single report is never shown on its own. A company&apos;s
              numbers appear only once enough people have reported the same thing —
              below that threshold, we show nothing, precisely so no individual report is
              identifiable.
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="font-serif text-xl text-ink mb-3">What this platform is not</h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            CandidateVoice is not affiliated with any company listed. Content is
            user-submitted and structured, not independently investigated. We do not verify
            employment, and a report describes a hiring interaction, not an accusation
            against a named individual.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="font-serif text-xl text-ink mb-3">Grievances and takedown requests</h2>
          <div className="text-sm text-ink-soft leading-relaxed space-y-3">
            <p className="border border-dashed border-rule-strong rounded-sm p-4 bg-paper-sheet">
              Required under India&apos;s Information Technology Rules, 2021 before this
              platform is promoted publicly — placeholders below, not yet real:
            </p>
            <ul className="space-y-1.5 pl-1">
              <li>
                Grievance Officer: <span className="text-ink-faint">[GRIEVANCE OFFICER NAME]</span>
              </li>
              <li>
                Registered contact address:{" "}
                <span className="text-ink-faint">[REGISTERED CONTACT ADDRESS]</span>
              </li>
              <li>
                Response timeline: <span className="text-ink-faint">[RESPONSE SLA]</span>
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="font-serif text-xl text-ink mb-3">Contact</h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            Security issues: see{" "}
            <a
              href="https://github.com/somanshu20000/candidatevoice/blob/main/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              SECURITY.md
            </a>
            .
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
