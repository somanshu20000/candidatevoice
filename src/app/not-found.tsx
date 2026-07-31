import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/**
 * 404. Reached by an unknown route, or by notFound() from a page.
 *
 * A company slug that does not resolve deliberately does NOT land here — the
 * company page renders its own "no reports yet" state instead, because an
 * unknown employer is a real, expected thing on this product and an invitation
 * to file the first report, not an error.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-20 w-full flex-1">
        <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-3">
          404
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-3">
          That page doesn&apos;t exist
        </h1>
        <p className="text-ink-soft mb-8 leading-relaxed">
          The link may be out of date, or the address may have a typo.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/companies"
            className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
          >
            Browse companies →
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 border border-rule-strong bg-paper-sheet text-ink-soft px-5 py-2.5 text-sm rounded-sm hover:border-ink-faint transition-colors"
          >
            Home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
