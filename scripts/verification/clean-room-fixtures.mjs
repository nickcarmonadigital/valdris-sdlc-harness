import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

export function writeJsonFixture(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function replaceExactStrings(value, replacements) {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value))
    return value.map((entry) => replaceExactStrings(entry, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceExactStrings(entry, replacements),
      ]),
    );
  }
  return value;
}

export function rewriteJsonArtifacts(target, replacements) {
  const roots = [
    "ai",
    "context",
    "design",
    "domain",
    "evals",
    "foundation",
    "goal",
    "graph",
    "production",
    "proof",
    "run",
    "smoke",
    "trajectory",
    "waivers",
  ];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const document = JSON.parse(readFileSync(file, "utf8"));
        writeJsonFixture(file, replaceExactStrings(document, replacements));
      }
    }
  };
  for (const root of roots) visit(path.join(target, root));
}

function tarOctal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

export function tarArchive(name, content, options = {}) {
  const body = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(tarOctal(0o644, 8), 100, 8, "ascii");
  header.write(tarOctal(0, 8), 108, 8, "ascii");
  header.write(tarOctal(0, 8), 116, 8, "ascii");
  header.write(tarOctal(body.length, 12), 124, 12, "ascii");
  header.write(tarOctal(Math.floor(Date.now() / 1000), 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = (options.type ?? "0").charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (options.uname) header.write(options.uname, 265, 32, "utf8");
  if (options.prefix) header.write(options.prefix, 345, 155, "utf8");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
}

export function gzipWithFilename(content, filename) {
  const plain = gzipSync(content);
  return Buffer.concat([
    plain.subarray(0, 3),
    Buffer.from([plain[3] | 0x08]),
    plain.subarray(4, 10),
    Buffer.from(`${filename}\0`, "utf8"),
    plain.subarray(10),
  ]);
}

export function parseWorkflowActionSteps(workflow) {
  const jobsIndex = workflow.indexOf("jobs:\n");
  if (jobsIndex < 0)
    throw new Error("protected residue workflow has no jobs mapping");
  const steps = [];
  let job = "";
  let step = null;
  let inWith = false;
  for (const line of workflow.slice(jobsIndex + "jobs:\n".length).split("\n")) {
    const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (jobMatch) {
      job = jobMatch[1];
      step = null;
      inWith = false;
      continue;
    }
    const stepMatch = line.match(/^      - name:\s*(.+?)\s*$/);
    if (stepMatch) {
      step = { job, name: stepMatch[1], uses: "", with: {} };
      steps.push(step);
      inWith = false;
      continue;
    }
    if (!step) continue;
    const usesMatch = line.match(/^        uses:\s*([^\s#]+)/);
    if (usesMatch) {
      step.uses = usesMatch[1];
      inWith = false;
      continue;
    }
    if (/^        with:\s*$/.test(line)) {
      inWith = true;
      continue;
    }
    const withMatch = inWith
      ? line.match(/^          ([a-zA-Z0-9_-]+):\s*(.*?)\s*$/)
      : null;
    if (withMatch) {
      step.with[withMatch[1]] = withMatch[2];
      continue;
    }
    if (/^        [a-zA-Z0-9_-]+:/.test(line) || /^      - /.test(line))
      inWith = false;
  }
  return steps;
}
