import { Inter } from "next/font/google";
import "./globals.css";
import React from "react";
import type { Metadata } from "next";

const inter = Inter({ subsets: ["latin"], display: "swap" });

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
    <html lang="en" className={inter.className}>
      <body>
        {children}
        <footer
          style={{ padding: "1rem", textAlign: "center", fontSize: "0.9rem" }}
        >
          © {new Date().getFullYear()} CandidateVoice. This site contains
          user-generated content that is not verified. The content may include
          inaccurate or unverified information.
        </footer>
      </body>
    </html>
  );
}
