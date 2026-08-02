import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/**
 * Shared route-loading skeleton. Rendered by each slow SSR route's loading.tsx
 * while the server component streams — so navigation paints the chrome and a
 * calm placeholder instantly instead of a blank page blocking on Supabase.
 *
 * Renders its own Navbar/Footer because the root layout carries only <html>/
 * <body>; every page (and every boundary) supplies its own chrome.
 */
export default function PageLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-14 w-full flex-1" aria-busy="true" aria-label={label}>
        <div className="animate-pulse space-y-8">
          <div className="space-y-3">
            <div className="h-9 w-1/2 bg-paper-sunk rounded-sm" />
            <div className="h-4 w-2/3 bg-paper-sunk rounded-sm" />
          </div>
          <div className="border border-rule bg-paper-sheet rounded-sm p-8 shadow-sheet space-y-4">
            <div className="h-4 w-24 bg-paper-sunk rounded-sm" />
            <div className="h-12 w-40 bg-paper-sunk rounded-sm" />
            <div className="h-3 w-1/2 bg-paper-sunk rounded-sm" />
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet h-40" />
            <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet h-40" />
          </div>
        </div>
        <span className="sr-only">{label}…</span>
      </main>
      <Footer />
    </div>
  );
}
