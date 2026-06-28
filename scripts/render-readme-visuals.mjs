#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("docs/assets/readme");
mkdirSync(OUT_DIR, { recursive: true });

const W = 1600;
const H = 900;

const colors = {
  bg0: "#020617",
  bg1: "#07111f",
  panel: "#0f172a",
  panel2: "#111827",
  line: "#334155",
  muted: "#94a3b8",
  text: "#e5e7eb",
  cyan: "#38bdf8",
  blue: "#60a5fa",
  indigo: "#818cf8",
  teal: "#2dd4bf",
  green: "#22c55e",
  amber: "#f59e0b",
  rose: "#fb7185",
  red: "#ef4444",
  violet: "#a78bfa",
};

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrap(text, max = 34) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if ((current + " " + word).length <= max) current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function defs() {
  return `
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="#0f2f4a" stop-opacity="0.72"/>
      <stop offset="45%" stop-color="#0b1220" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="1"/>
    </radialGradient>
    <linearGradient id="cardFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#172554" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="softFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111827" stop-opacity="0.96"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="cyanFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0e7490" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="amberFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#92400e" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="roseFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#881337" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" opacity="0.85"/>
    </marker>
    <marker id="arrowAmber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" opacity="0.9"/>
    </marker>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" stroke-width="1" opacity="0.35"/>
    </pattern>
  </defs>`;
}

function shell(title, subtitle = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
  ${defs()}
  <rect width="${W}" height="${H}" fill="url(#bgGlow)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.6"/>
  <circle cx="1350" cy="-120" r="420" fill="#1d4ed8" opacity="0.14"/>
  <circle cx="160" cy="900" r="420" fill="#0f766e" opacity="0.13"/>
  <text x="64" y="64" fill="${colors.text}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial" font-size="34" font-weight="800">${esc(title)}</text>
  ${subtitle ? `<text x="66" y="98" fill="${colors.muted}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial" font-size="16" font-weight="500">${esc(subtitle)}</text>` : ""}
`;
}

function endSvg() {
  return `</svg>\n`;
}

function card(x, y, w, h, title, opts = {}) {
  const {
    sub = "",
    stroke = colors.cyan,
    fill = "url(#softFill)",
    titleSize = 20,
    subSize = 13,
    badge = "",
    align = "left",
    rx = 18,
    opacity = 1,
    maxChars = Math.max(18, Math.floor(w / 9.2)),
  } = opts;
  const titleLines = Array.isArray(title) ? title : wrap(title, maxChars);
  const subLines = sub ? (Array.isArray(sub) ? sub : wrap(sub, Math.max(22, Math.floor(w / 7.4)))) : [];
  const textX = align === "center" ? x + w / 2 : x + 20;
  const anchor = align === "center" ? "middle" : "start";
  let t = `<g filter="url(#shadow)" opacity="${opacity}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.4" opacity="0.96"/>
    <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${Math.max(12, h * 0.34)}" rx="${rx}" fill="#ffffff" opacity="0.035"/>
  </g>`;
  if (badge) {
    t += `<rect x="${x + 14}" y="${y + 12}" width="${Math.max(34, badge.length * 9 + 18)}" height="26" rx="13" fill="${stroke}" opacity="0.14" stroke="${stroke}" stroke-opacity="0.7"/>
    <text x="${x + 14 + Math.max(34, badge.length * 9 + 18) / 2}" y="${y + 30}" text-anchor="middle" fill="${stroke}" font-family="Inter, ui-sans-serif, system-ui" font-size="13" font-weight="800">${esc(badge)}</text>`;
  }
  let yCursor = y + (badge ? 58 : 30);
  for (const line of titleLines) {
    t += `<text x="${textX}" y="${yCursor}" text-anchor="${anchor}" fill="${colors.text}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial" font-size="${titleSize}" font-weight="800">${esc(line)}</text>`;
    yCursor += titleSize + 4;
  }
  if (subLines.length) {
    yCursor += 4;
    for (const line of subLines.slice(0, 3)) {
      t += `<text x="${textX}" y="${yCursor}" text-anchor="${anchor}" fill="${colors.muted}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial" font-size="${subSize}" font-weight="600">${esc(line)}</text>`;
      yCursor += subSize + 5;
    }
  }
  return `<g>${t}</g>`;
}

function label(x, y, text, opts = {}) {
  const { size = 15, color = colors.muted, weight = 700, anchor = "start" } = opts;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial" font-size="${size}" font-weight="${weight}">${esc(text)}</text>`;
}

function pill(x, y, text, color = colors.cyan, w = null) {
  const width = w || text.length * 8 + 28;
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="30" rx="15" fill="${color}" opacity="0.13" stroke="${color}" stroke-opacity="0.75"/>
    <text x="${x + width / 2}" y="${y + 20}" text-anchor="middle" fill="${color}" font-family="Inter, ui-sans-serif, system-ui" font-size="13" font-weight="800">${esc(text)}</text>
  </g>`;
}

function arrow(x1, y1, x2, y2, color = colors.cyan, marker = "arrow", width = 2) {
  return `<path d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="0.78" marker-end="url(#${marker})"/>`;
}

function lineArrow(x1, y1, x2, y2, color = colors.cyan, marker = "arrow", width = 2) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-opacity="0.82" marker-end="url(#${marker})"/>`;
}

function miniCard(x, y, w, h, text, color = colors.cyan, opts = {}) {
  const { size = 16, fill = "url(#softFill)", weight = 800 } = opts;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${color}" stroke-width="1.2" opacity="0.96"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" fill="${colors.text}" font-family="Inter, ui-sans-serif, system-ui" font-size="${size}" font-weight="${weight}">${esc(text)}</text>
  </g>`;
}

function write(name, svg) {
  const file = path.join(OUT_DIR, name);
  writeFileSync(file, svg);
  console.log(`wrote ${file}`);
}

function workLanesMap() {
  let s = shell("Valdris SDLC Harness — Work Lanes Map", "Work enters once, routes by lane, then every lane must pass shared gates and artifacts.");
  const cx = W / 2;
  s += card(cx - 270, 122, 540, 78, "Front doors", { sub: "AGENTS.md / CLAUDE.md / Codex prompt", stroke: colors.cyan, fill: "url(#cyanFill)", align: "center" });
  s += lineArrow(cx, 202, cx, 236, colors.cyan);
  s += card(cx - 270, 238, 540, 78, "Orient + Route", { sub: "00_MAP.md / CONTEXT.md / project adapter", stroke: colors.indigo, fill: "url(#cardFill)", align: "center" });
  s += lineArrow(cx, 318, cx, 352, colors.cyan);
  s += card(cx - 270, 354, 540, 72, "Lane Classification", { sub: "choose the right operating lane before work starts", stroke: colors.teal, align: "center" });
  s += label(80, 472, "Generated Work Lanes", { size: 22, color: colors.text, weight: 850 });
  s += label(80, 500, "Different work routes through different lanes before implementation starts.", { size: 15, color: colors.muted, weight: 600 });
  const lanes = [
    ["engineering-default", colors.cyan], ["system-design", colors.indigo], ["production-readiness", colors.teal], ["cloud-platform", colors.amber], ["qa-release", colors.green],
    ["incidents", colors.rose], ["docs-product", colors.blue], ["infra", colors.amber], ["data", colors.teal], ["security", colors.rose],
    ["agent-runtime", colors.violet], ["support-triage", colors.blue], ["provider-config", colors.amber], ["voice-vapi", colors.teal], ["rag-kb-evals", colors.indigo],
  ];
  const startX = 80;
  const startY = 530;
  const cw = 282;
  const ch = 58;
  const gapX = 18;
  const gapY = 16;
  lanes.forEach(([name, color], i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    s += miniCard(startX + col * (cw + gapX), startY + row * (ch + gapY), cw, ch, name, color, { size: 17 });
    if (row === 0) s += lineArrow(cx, 428, startX + col * (cw + gapX) + cw / 2, startY - 8, colors.cyan, "arrow", 1.2);
  });
  const bottomY = 772;
  s += card(80, bottomY, 445, 78, "Shared stage flow", { sub: "intake → route → GitNexus → design-anchors → implement → validate → handoff", stroke: colors.cyan, titleSize: 19, subSize: 12 });
  s += card(577, bottomY, 445, 78, "Shared gates", { sub: "RCA / anchor / Red Zone / proof / smoke / finish-line / self-heal", stroke: colors.rose, titleSize: 19, subSize: 12 });
  s += card(1075, bottomY, 445, 78, "Run packet artifacts", { sub: "graph/graph.json / design/anchors.json / proof/proof.json / smoke/smoke_proof.json / handoff/final.md", stroke: colors.green, titleSize: 19, subSize: 12, maxChars: 34 });
  s += lineArrow(525, bottomY + 39, 577, bottomY + 39, colors.cyan);
  s += lineArrow(1022, bottomY + 39, 1075, bottomY + 39, colors.cyan);
  s += label(80, 875, "Core promise: different kinds of engineering work route through different lanes, but all lanes must leave proof.", { color: colors.muted, size: 15 });
  return s + endSvg();
}

function repoOperatingMap() {
  let s = shell("Valdris SDLC Harness — Whole Repo Operating Map", "Grouped by responsibility: front doors, docs, generator, runtime, repo intelligence, gates, and evidence.");
  const cluster = (x, y, w, h, title, color) => `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#020617" opacity="0.42" stroke="${color}" stroke-width="1.3" stroke-opacity="0.75"/>
    ${label(x + 20, y + 32, title, { size: 20, color, weight: 850 })}
  </g>`;
  s += cluster(54, 128, 300, 230, "Front doors", colors.cyan);
  s += miniCard(80, 180, 248, 44, "README.md", colors.cyan);
  s += miniCard(80, 238, 248, 44, "AGENTS.md", colors.cyan);
  s += miniCard(80, 296, 248, 44, "CLAUDE.md", colors.cyan);

  s += cluster(54, 392, 300, 486, "Operating docs", colors.indigo);
  ["ARCHITECTURE.md", "CONNECTOR_EVENT_CONTRACT.md", "SDLC_LANE_TAXONOMY.md", "MODES_BLUEPRINT_LIVE_REPLAY.md", "PRODUCTION_READINESS_LAYER_PACK.md", "ENTERPRISE_PROOF_BANK.md", "OPERATING_INTELLIGENCE_LAYER.md", "TEST_DAY_ACCEPTANCE_GATES.md", "HARNESS_REPO_MAP.md"].forEach((t, i) => {
    s += miniCard(80, 444 + i * 44, 248, 34, t, colors.indigo, { size: 10.5 });
  });

  s += cluster(414, 160, 330, 244, "Commissioning generator", colors.amber);
  s += miniCard(444, 216, 270, 46, "commission-harness.mjs", colors.amber, { size: 15 });
  s += miniCard(444, 278, 270, 46, "templates/", colors.amber, { size: 16 });
  s += miniCard(444, 340, 270, 46, "generated harness pack", colors.green, { size: 15 });

  s += cluster(414, 468, 330, 246, "Runtime connector", colors.teal);
  ["claude-code-bridge.mjs", "uash-emit-event.mjs", "simulate-agent-run.mjs"].forEach((t, i) => {
    s += miniCard(444, 526 + i * 58, 270, 42, t, colors.teal, { size: 14 });
  });

  s += cluster(804, 128, 332, 262, "Repo intelligence", colors.blue);
  ["code-intelligence-scan.mjs", "graphify-gate.mjs", "anchor-gate.mjs", "graph/gitnexus.json", "graph/graph.json", "design/anchors.json"].forEach((t, i) => {
    s += miniCard(832, 174 + i * 38, 276, 31, t, i < 3 ? colors.blue : colors.green, { size: 11.5 });
  });

  s += cluster(804, 442, 332, 300, "Verification gates", colors.rose);
  ["verify-harness.mjs", "proof/proof.json", "smoke/smoke_proof.json", "approvals/redzone.json", "self_heal/self_heal_report.md"].forEach((t, i) => {
    s += miniCard(832, 494 + i * 46, 276, 35, t, i === 0 ? colors.rose : colors.green, { size: 13 });
  });

  s += cluster(1200, 128, 340, 278, "Visual control-plane app", colors.cyan);
  ["app/", "components/", "lib/", "app/api/runs/demo/events"].forEach((t, i) => {
    s += miniCard(1230, 182 + i * 52, 280, 38, t, colors.cyan, { size: 15 });
  });

  s += cluster(1200, 472, 340, 226, "Run packets + evidence", colors.green);
  ["runs/_run-template/", "session/events.jsonl", "handoff/final.md"].forEach((t, i) => {
    s += miniCard(1230, 528 + i * 58, 280, 42, t, colors.green, { size: 15 });
  });

  s += arrow(354, 240, 414, 240, colors.cyan);
  s += arrow(354, 540, 414, 282, colors.indigo);
  s += arrow(744, 340, 804, 250, colors.amber, "arrowAmber");
  s += arrow(744, 600, 804, 590, colors.teal);
  s += arrow(1136, 260, 1200, 260, colors.blue);
  s += arrow(1136, 585, 1200, 585, colors.rose);
  s += arrow(1370, 472, 1370, 408, colors.green);
  s += label(66, 824, "Read this as an operating system map, not a raw import graph. The repo is organized around agent front doors, runtime events, proof gates, and handoff evidence.", { size: 15, color: colors.muted });
  return s + endSvg();
}

function flowMonitor() {
  let s = shell("Valdris SDLC Harness — Visual Flow Monitor", "Blueprint / Live Run / Replay modes keep static topology separate from real telemetry.");
  s += `<rect x="64" y="122" width="1472" height="704" rx="28" fill="#030712" opacity="0.86" stroke="#334155" stroke-width="1.4" filter="url(#shadow)"/>`;
  s += label(96, 172, "Run board", { size: 23, color: colors.text, weight: 850 });
  s += pill(220, 148, "Blueprint", colors.cyan, 105);
  s += pill(338, 148, "Live Run", colors.teal, 105);
  s += pill(456, 148, "Replay", colors.indigo, 88);
  s += label(1276, 172, "demo topology only", { size: 14, color: colors.amber, weight: 800 });

  const canvasX = 92, canvasY = 210, canvasW = 1000, canvasH = 402;
  s += `<rect x="${canvasX}" y="${canvasY}" width="${canvasW}" height="${canvasH}" rx="22" fill="#07111f" stroke="#1e293b"/>`;
  s += label(canvasX + 24, canvasY + 36, "N8N-style SDLC swimlane", { size: 17, color: colors.muted, weight: 800 });
  const nodes = [
    ["intake", colors.green, 0], ["route", colors.green, 1], ["GitNexus", colors.green, 2], ["design-anchors", colors.green, 3],
    ["system-design", colors.indigo, 4], ["production-readiness", colors.amber, 5], ["cloud-platform", colors.amber, 6],
    ["implement", colors.cyan, 7], ["redzone", colors.rose, 8], ["qa-break-it", colors.violet, 9], ["prove", colors.rose, 10],
    ["live-smoke", colors.teal, 11], ["self-heal", colors.amber, 12], ["handoff", colors.green, 13],
  ];
  const nx0 = canvasX + 30;
  const ny0 = canvasY + 118;
  const nw = 112;
  const nh = 48;
  const xGap = 14;
  nodes.forEach(([name, color], i) => {
    const row = i < 7 ? 0 : 1;
    const col = row === 0 ? i : i - 7;
    const x = nx0 + col * (nw + xGap);
    const y = ny0 + row * 122;
    s += miniCard(x, y, nw, nh, name, color, { size: name.length > 12 ? 10.5 : name.length > 10 ? 11.5 : 13 });
    if (i !== 6 && i !== 13) {
      const nextRow = i + 1 < 7 ? 0 : 1;
      const nextCol = nextRow === 0 ? i + 1 : i + 1 - 7;
      const nx = nx0 + nextCol * (nw + xGap);
      const ny = ny0 + nextRow * 122;
      if (row === nextRow) s += lineArrow(x + nw, y + nh / 2, nx - 8, ny + nh / 2, color, "arrow", 1.5);
    }
  });
  s += arrow(nx0 + 6 * (nw + xGap) + nw / 2, ny0 + nh + 8, nx0, ny0 + 122 - 10, colors.cyan);

  // Inspector panel.
  s += `<rect x="1126" y="210" width="382" height="402" rx="22" fill="#0f172a" stroke="#334155"/>`;
  s += label(1154, 250, "Selected node", { size: 15, color: colors.muted, weight: 800 });
  s += label(1154, 286, "prove", { size: 36, color: colors.text, weight: 900 });
  s += pill(1282, 258, "blocked", colors.rose, 102);
  s += card(1154, 318, 318, 86, "Required artifact", { sub: "proof/proof.json must exist and pass", stroke: colors.rose, titleSize: 18, subSize: 13 });
  s += card(1154, 424, 318, 76, "Last event", { sub: "node.entered from connector bridge", stroke: colors.cyan, titleSize: 18, subSize: 13 });
  s += card(1154, 520, 318, 62, "Gate result", { sub: "finish-line not satisfied", stroke: colors.amber, titleSize: 18, subSize: 13 });

  const ledgerY = 646;
  s += `<rect x="92" y="${ledgerY}" width="1416" height="136" rx="22" fill="#07111f" stroke="#1e293b"/>`;
  s += label(120, ledgerY + 36, "Event stream + artifact ledger", { size: 18, color: colors.text, weight: 850 });
  [
    ["10:42:17", "GitNexus", "wrote graph/gitnexus.json", colors.green],
    ["10:43:02", "design-anchors", "wrote design/anchors.json", colors.green],
    ["10:47:18", "prove", "blocked: missing proof/proof.json", colors.rose],
    ["10:48:09", "redzone", "human approval required", colors.amber],
  ].forEach((row, i) => {
    const x = 120 + i * 344;
    const w = 316;
    s += `<rect x="${x}" y="${ledgerY + 56}" width="${w}" height="56" rx="14" fill="#020617" opacity="0.55" stroke="${row[3]}" stroke-opacity="0.35"/>`;
    s += pill(x + 14, ledgerY + 68, row[0], colors.indigo, 82);
    s += label(x + 110, ledgerY + 88, row[1], { size: row[1].length > 12 ? 12 : 14, color: row[3], weight: 850 });
    s += label(x + 14, ledgerY + 126, row[2], { size: 13, color: colors.muted, weight: 700 });
  });
  s += label(96, 854, "This visual intentionally shows the control plane preventing fake completion — not a magical live dashboard.", { size: 15, color: colors.muted });
  return s + endSvg();
}

function productionReadiness() {
  let s = shell("Valdris SDLC Harness — 13-Layer Production Readiness Pack", "A production-impacting run cannot be called done until touched layers are assessed with proof.");
  s += card(560, 126, 480, 74, "production-impacting run", { sub: "feature, deploy, data, auth, cloud, incident, or reliability work", stroke: colors.cyan, align: "center", fill: "url(#cyanFill)" });
  s += lineArrow(800, 204, 800, 244, colors.cyan);
  s += card(540, 246, 520, 76, "production readiness layer pack", { sub: "mark each layer required / passed / failed / pending / skipped with reason", stroke: colors.amber, align: "center", fill: "url(#amberFill)" });
  const groups = [
    ["Product surface", 80, 382, colors.cyan, ["01 Frontend", "02 Backend / API", "03 Database / storage", "04 Auth / permissions / RLS"]],
    ["Platform surface", 510, 382, colors.amber, ["05 Hosting / deployment", "06 Cloud / compute", "07 CI/CD / version control", "08 Security", "09 Rate limiting", "10 Caching / CDN", "11 Load balancing / scaling"]],
    ["Operational survival", 1080, 382, colors.teal, ["12 Logs / observability", "13 Availability / recovery / DR"]],
  ];
  for (const [title, x, y, color, items] of groups) {
    const h = title === "Platform surface" ? 356 : 236;
    s += `<rect x="${x}" y="${y}" width="${title === "Platform surface" ? 500 : 390}" height="${h}" rx="24" fill="#020617" opacity="0.44" stroke="${color}" stroke-opacity="0.78"/>`;
    s += label(x + 24, y + 38, title, { size: 21, color, weight: 850 });
    items.forEach((item, i) => {
      const col = title === "Platform surface" && i >= 4 ? 1 : 0;
      const row = title === "Platform surface" && i >= 4 ? i - 4 : i;
      const cw = title === "Platform surface" ? 220 : 330;
      const xx = x + 24 + col * 236;
      const yy = y + 66 + row * 42;
      s += miniCard(xx, yy, cw, 32, item, color, { size: 13 });
    });
    s += lineArrow(800, 324, x + (title === "Platform surface" ? 250 : 195), y - 14, color, title === "Platform surface" ? "arrowAmber" : "arrow", 1.6);
  }
  s += card(430, 748, 740, 66, "production/layer-assessment.json → finish-line gate", { sub: "status must be required/passed/failed/pending/skipped with reason", stroke: colors.green, titleSize: 21, subSize: 13, align: "center" });
  s += lineArrow(800, 724, 800, 746, colors.green);
  return s + endSvg();
}

function connectorFlow() {
  let s = shell("Valdris SDLC Harness — Connector + Proof Gate Overview", "External agents only become trustworthy when they emit validated events and artifact evidence.");
  s += `<rect x="64" y="136" width="300" height="340" rx="26" fill="#020617" opacity="0.46" stroke="${colors.blue}"/>`;
  s += label(92, 176, "External coding agents", { size: 21, color: colors.blue, weight: 850 });
  ["Claude Code", "Codex", "Hermes", "future runtime"].forEach((t, i) => s += miniCard(96, 216 + i * 60, 236, 42, t, colors.blue, { size: 16 }));
  const steps = [
    ["CLI emitter / MCP / API / watched artifact", colors.cyan],
    ["local connector bridge", colors.teal],
    ["strict event validation", colors.amber],
    ["event ledger + run packet", colors.green],
    ["proof gate engine", colors.rose],
  ];
  const stepXs = [400, 610, 820, 1030, 1240];
  steps.forEach(([t, color], i) => {
    s += card(stepXs[i], 238, 176, 116, t, { stroke: color, titleSize: 16, align: "center", maxChars: 17 });
    if (i < steps.length - 1) s += lineArrow(stepXs[i] + 176, 296, stepXs[i + 1] - 10, 296, color, color === colors.amber ? "arrowAmber" : "arrow");
  });
  s += lineArrow(364, 306, 400, 296, colors.blue);
  s += card(742, 430, 300, 78, "visual run monitor", { sub: "reads events, artifacts, skip/fail state", stroke: colors.cyan, titleSize: 20 });
  s += arrow(1118, 354, 890, 430, colors.cyan);
  const outcomes = [
    ["reject: unknown node or bad schema", colors.rose],
    ["block: finish-line not satisfied", colors.rose],
    ["block: Red Zone needs human", colors.amber],
    ["self-heal artifact or PR", colors.amber],
    ["proof-backed handoff", colors.green],
  ];
  outcomes.forEach(([t, color], i) => {
    const yy = 476 + i * 56;
    s += miniCard(1128, yy, 340, 38, t, color, { size: 14 });
    s += arrow(1328, 354, 1128, yy + 19, color, color === colors.amber ? "arrowAmber" : "arrow", 1.2);
  });
  s += card(92, 586, 750, 94, "Run packet ledger", { sub: "run/intake.json / graph/graph.json / design/anchors.json / proof/proof.json / smoke/smoke_proof.json / handoff/final.md", stroke: colors.green, titleSize: 22, subSize: 13, maxChars: 70 });
  s += label(92, 752, "No agent can claim done until required events, artifacts, approvals, and smoke checks pass.", { size: 19, color: colors.text, weight: 850 });
  return s + endSvg();
}

function universalAdapter() {
  let s = shell("Valdris SDLC Harness — Universal Core vs Project Adapter", "The product is universal; every repo gets a generated operating layer.");
  s += card(80, 180, 230, 78, "team or operator", { stroke: colors.cyan, align: "center" });
  s += card(80, 312, 230, 78, "target repository", { stroke: colors.blue, align: "center" });
  s += card(380, 160, 260, 92, "commissioning interview", { sub: "human answers + repo rules", stroke: colors.cyan, align: "center" });
  s += card(380, 300, 260, 92, "GitNexus index", { sub: "code intelligence + anchors", stroke: colors.blue, align: "center" });
  s += arrow(310, 218, 380, 206, colors.cyan);
  s += arrow(310, 350, 380, 346, colors.blue);
  s += `<rect x="710" y="128" width="330" height="408" rx="26" fill="#020617" opacity="0.44" stroke="${colors.indigo}"/>`;
  s += label(740, 170, "Universal core", { size: 24, color: colors.indigo, weight: 900 });
  ["adapter schema", "lane taxonomy", "canonical stage flow", "connector event contract", "proof and approval gates", "visual flow monitor"].forEach((t, i) => s += miniCard(742, 205 + i * 48, 266, 34, t, colors.indigo, { size: 13 }));
  s += `<rect x="1110" y="128" width="330" height="360" rx="26" fill="#020617" opacity="0.44" stroke="${colors.amber}"/>`;
  s += label(1140, 170, "Generated adapter", { size: 24, color: colors.amber, weight: 900 });
  ["source-of-truth order", "validation commands", "Red Zone owners", "enabled lanes", "answer + handoff style"].forEach((t, i) => s += miniCard(1142, 205 + i * 54, 266, 36, t, colors.amber, { size: 13 }));
  s += arrow(640, 208, 710, 238, colors.cyan);
  s += arrow(640, 346, 710, 360, colors.blue);
  s += lineArrow(1040, 320, 1110, 320, colors.amber, "arrowAmber");
  s += card(392, 624, 280, 102, "Project-specific harness pack", { sub: "AGENTS.md / CLAUDE.md / slash command / Codex prompt / run packet template", stroke: colors.green, titleSize: 19, subSize: 12, maxChars: 28 });
  s += card(720, 624, 280, 102, ["Claude/Codex/Hermes", "run"], { sub: "external runtime, harness-visible events", stroke: colors.cyan, titleSize: 18, subSize: 12, maxChars: 24 });
  s += card(1048, 624, 280, 102, "proof-backed handoff", { sub: "answers cite artifacts and gate results", stroke: colors.green, titleSize: 19, subSize: 12, maxChars: 28 });
  s += arrow(1275, 488, 532, 624, colors.amber, "arrowAmber");
  s += lineArrow(672, 675, 720, 675, colors.cyan);
  s += lineArrow(1000, 675, 1048, 675, colors.green);
  return s + endSvg();
}

function generatedPack() {
  let s = shell("Valdris SDLC Harness — Generated Harness Pack", "Commissioning turns a normal repo into an AI-operable repo with front doors, rules, run packets, and helper scripts.");
  const inputs = [["target repo", colors.blue], ["human answers", colors.cyan], ["GitNexus index", colors.indigo]];
  inputs.forEach(([t, color], i) => {
    const x = 220 + i * 240;
    s += card(x, 150, 190, 72, t, { stroke: color, align: "center", titleSize: 19 });
    s += arrow(x + 95, 224, 800, 310, color, color === colors.indigo ? "arrowAmber" : "arrow", 1.5);
  });
  s += card(620, 300, 360, 92, "commission-harness.mjs", { sub: "repo-specific operating kit generator", stroke: colors.amber, align: "center", fill: "url(#amberFill)", titleSize: 24 });
  const groups = [
    ["Agent front doors", 78, 488, colors.cyan, ["AGENTS.md", "CLAUDE.md", ".claude/commands/...", "Codex Runtime Prompt.md"]],
    ["Project adapter", 388, 488, colors.amber, ["project-adapter.json", "project.yaml", "00_MAP.md", "CONTEXT.md"]],
    ["Operating docs", 698, 488, colors.indigo, ["Validation Commands.md", "Red Zone Rules.md", "Production Readiness Layers.md", "QA and Live Smoke.md"]],
    ["Run packet", 1008, 488, colors.green, ["runs/_run-template/", "commissioning-review.md"]],
    ["Helper scripts", 1268, 488, colors.teal, ["uash-emit-event.mjs", "code-intelligence-scan.mjs"]],
  ];
  groups.forEach(([title, x, y, color, items]) => {
    const w = title === "Run packet" || title === "Helper scripts" ? 236 : 270;
    const h = 250;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#020617" opacity="0.45" stroke="${color}"/>`;
    s += label(x + 18, y + 36, title, { size: 19, color, weight: 850 });
    items.forEach((t, i) => s += miniCard(x + 18, y + 66 + i * 42, w - 36, 32, t, color, { size: t.length > 22 ? 11 : 13 }));
    s += arrow(800, 392, x + w / 2, y - 10, color, color === colors.amber ? "arrowAmber" : "arrow", 1.4);
  });
  s += label(80, 820, "Output shape: generated instructions + repo adapter + validation docs + evidence packet + connector helpers.", { size: 17, color: colors.muted, weight: 750 });
  return s + endSvg();
}

write("work-lanes-map.svg", workLanesMap());
write("repo-operating-map.svg", repoOperatingMap());
write("flow-monitor-dashboard.svg", flowMonitor());
write("production-readiness-pack.svg", productionReadiness());
write("connector-proof-gate-overview.svg", connectorFlow());
write("universal-core-project-adapter.svg", universalAdapter());
write("generated-harness-pack.svg", generatedPack());
