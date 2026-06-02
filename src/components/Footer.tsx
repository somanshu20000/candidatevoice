export default function Footer() {
  return (
    <footer className="border-t border-[#334155] mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-xs text-[#64748B] leading-relaxed">
              <span className="text-[#94A3B8] font-medium">Disclaimer:</span>{" "}
              CandidateVoice contains user-generated content that has not been independently verified.
              Submissions are anonymized and moderated to remove names, proprietary information,
              and defamatory content. This platform is not affiliated with any company listed.
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="font-mono text-[11px] border border-[#334155] text-[#64748B] px-2 py-0.5 rounded">
              MIT
            </span>
            <span className="font-mono text-[11px] border border-[#334155] text-[#64748B] px-2 py-0.5 rounded">
              CC0 Data
            </span>
            <a
              href="https://github.com/somanshu20000/candidatevoice"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-[#64748B] hover:text-[#38BDF8] transition-colors"
            >
              GitHub →
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
