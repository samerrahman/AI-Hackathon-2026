import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SetBeta — AI co-setter",
  description: "Propose bouldering route concepts from a wall photo and a hold-inventory photo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
