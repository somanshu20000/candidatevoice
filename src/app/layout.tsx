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
      <body className="bg-[#0F172A]">
        {children}
      </body>
    </html>
  );
}
