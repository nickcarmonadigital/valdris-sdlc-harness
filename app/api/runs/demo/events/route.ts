import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { demoRunEvents, type RunEvent } from "../../../../../lib/run-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventFile = path.join(process.cwd(), "data", "runs", "demo", "events.jsonl");

async function readLocalEvents(): Promise<RunEvent[]> {
  try {
    const raw = await readFile(eventFile, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent);
  } catch {
    return demoRunEvents;
  }
}

export async function GET() {
  const events = await readLocalEvents();
  return NextResponse.json({
    mode: events === demoRunEvents ? "demo" : "on-prem-jsonl",
    storage: events === demoRunEvents ? "bundled seed data" : eventFile,
    events,
  });
}
