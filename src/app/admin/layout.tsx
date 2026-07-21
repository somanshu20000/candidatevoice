import type { Metadata } from "next";

// admin/page.tsx is a client component ("use client"), which can't export
// `metadata` itself — Next.js only reads metadata exports from Server
// Components. This layout wraps it purely to keep the page out of search
// engine indexes; it carries no auth logic of its own (the page still
// requires ADMIN_SECRET for every API call, same as before).
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
