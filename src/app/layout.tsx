import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Klub · csoportos chat ChatGPT-vel, Copilottal, Geminivel, Perplexityvel és Claude-dal",
  description:
    "Valós idejű csoportos chat, ahol emberek és öt AI-asszisztens beszélgetnek egymással párhuzamosan.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hu">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
