import { Inter, EB_Garamond } from "next/font/google";
import "./globals.css";
import React from "react";
import type { Metadata } from "next";

// Both fonts are downloaded and self-hosted by next/font at build time, so they
// satisfy the `font-src 'self'` CSP in next.config.js — no external origin.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Bookish serif for display type; carries the printed-page character.
const garamond = EB_Garamond({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "CandidateVoice",
  description: "Anonymous rejection experiences to level the playing field.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${garamond.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
