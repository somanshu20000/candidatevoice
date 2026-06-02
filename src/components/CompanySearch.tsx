"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CompanySearch() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const slug = query.trim().toLowerCase().replace(/\s+/g, "-");
    if (slug) router.push(`/company/${encodeURIComponent(slug)}`);
  }

  return (
    <section className="max-w-6xl mx-auto px-4 py-10 w-full border-b border-[#334155]">
      <h2 className="text-xl font-semibold text-white mb-4">Search a company</h2>
      <form onSubmit={handleSubmit} className="flex gap-3 max-w-lg">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Google, Razorpay, Swiggy..."
          className="flex-1 bg-[#1E293B] border border-[#334155] text-white text-sm rounded px-4 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors placeholder:text-[#475569]"
        />
        <button
          type="submit"
          disabled={!query.trim()}
          className="bg-[#38BDF8] text-[#0F172A] text-sm font-semibold px-4 py-2.5 rounded hover:bg-[#7DD3FC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          View Hiring Intel
        </button>
      </form>
    </section>
  );
}
