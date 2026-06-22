import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Valdris SDLC Harness Flow Monitor",
  description:
    "A non-IDE visual flow monitor for Claude Code, Codex, Hermes, Graphify, skill packs, workflow gates, artifacts, skip reasons, and run telemetry.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
