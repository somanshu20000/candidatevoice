import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-rule mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="max-w-xl">
            <p className="text-xs text-ink-muted leading-relaxed">
              <span className="text-ink-soft font-medium">Disclaimer:</span>{" "}
              CandidateVoice contains user-generated content that has not been
              independently verified. Submissions are anonymized and moderated to
              remove names, proprietary information, and defamatory content. This
              platform is not affiliated with any company listed.
            </p>
            <Link href="/legal" className="text-[11px] font-mono text-ink-faint hover:text-accent transition-colors mt-2 inline-block">
              Legal &amp; Privacy →
            </Link>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono text-[10px] uppercase tracking-wider border border-rule text-ink-muted px-2 py-1 rounded-sm">
              MIT
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider border border-rule text-ink-muted px-2 py-1 rounded-sm">
              CC0 Data
            </span>
            <a
              href="https://github.com/somanshu20000/candidatevoice"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-ink-muted hover:text-accent transition-colors"
            >
              GitHub →
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
