import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Universal Harness Control Plane",
  description:
    "A local-first agentic SDLC control-plane application for Claude Code, Codex, Hermes, workflow gates, artifacts, and run telemetry.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
