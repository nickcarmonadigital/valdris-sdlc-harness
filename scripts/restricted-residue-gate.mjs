#!/usr/bin/env node
import { closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const MANIFEST_SCHEMA = "valdris.restricted-residue-input.v1";
const REPOSITORY_IGNORES = new Set([".git", ".gitnexus", "node_modules", "coverage"]);
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH = 3;
const MAX_FINDINGS = 512;
const MAX_GZIP_HEADER_BYTES = 64 * 1024;
const MAX_GZIP_HEADERS = 128;

function parseArgs(argv) {
  const args = { repo: process.cwd(), manifest: process.env.VALDRIS_RESTRICTED_VALUES_FILE || null, releaseArchives: [], generatedPacks: [], generatedPackArchives: [], knowledgeVaults: [], installedSkillManifests: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--manifest" || arg === "--restricted-values") args.manifest = argv[++index];
    else if (arg === "--release-archive") args.releaseArchives.push(argv[++index]);
    else if (arg === "--generated-pack") args.generatedPacks.push(argv[++index]);
    else if (arg === "--generated-pack-archive") args.generatedPackArchives.push(argv[++index]);
    else if (arg === "--knowledge-vault") args.knowledgeVaults.push(argv[++index]);
    else if (arg === "--installed-skill-manifest") args.installedSkillManifests.push(argv[++index]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error("unknown restricted-residue gate argument");
  }
  return args;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertNoSymlinkBoundary(absolute) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("restricted-residue input cannot cross a symbolic-link boundary");
  }
}

function realNonSymlinkPath(requested, expectedType, maxBytes = null) {
  const absolute = path.resolve(requested);
  assertNoSymlinkBoundary(absolute);
  if (!existsSync(absolute)) throw new Error("restricted-residue surface must exist without a symbolic-link boundary");
  const stats = lstatSync(absolute);
  if ((expectedType === "file" && !stats.isFile()) || (expectedType === "directory" && !stats.isDirectory())) throw new Error(`restricted-residue surface must be a real ${expectedType}`);
  if (maxBytes !== null && stats.size > maxBytes) throw new Error("restricted-residue input exceeded its byte bound");
  return realpathSync(absolute);
}

function fileIdentity(stats) {
  return `${stats.dev}:${stats.ino}:${stats.mode}:${stats.size}:${stats.mtimeNs ?? stats.mtimeMs}:${stats.ctimeNs ?? stats.ctimeMs}`;
}

function readBoundedRegularFile(requested, maxBytes) {
  const absolute = path.resolve(requested);
  assertNoSymlinkBoundary(absolute);
  if (!existsSync(absolute)) throw new Error("restricted-residue file input is missing");
  const before = lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes)) throw new Error("restricted-residue input must be a bounded regular non-symlink file");
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW || 0);
  const descriptor = openSync(absolute, fsConstants.O_RDONLY | noFollow);
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || openedBefore.size > BigInt(maxBytes) || fileIdentity(openedBefore) !== fileIdentity(before)) throw new Error("restricted-residue input changed before reading");
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    assertNoSymlinkBoundary(absolute);
    if (!existsSync(absolute) || fileIdentity(openedAfter) !== fileIdentity(openedBefore) || fileIdentity(lstatSync(absolute, { bigint: true })) !== fileIdentity(openedBefore) || BigInt(bytes.length) !== openedBefore.size) throw new Error("restricted-residue input changed while reading");
    return { bytes, real: realpathSync(absolute) };
  } finally {
    closeSync(descriptor);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalized(value) {
  return value.normalize("NFC");
}

function loadManifest(file, repo) {
  if (!file) throw new Error("an external restricted-values manifest is required");
  const input = readBoundedRegularFile(file, MAX_MANIFEST_BYTES);
  const target = input.real;
  if (isWithin(realpathSync(repo), target)) throw new Error("restricted-values manifest must remain outside the public repository");
  let document;
  try { document = JSON.parse(input.bytes.toString("utf8")); }
  catch { throw new Error("restricted-values manifest must contain valid JSON"); }
  if (!document || typeof document !== "object" || Array.isArray(document) || document.schema !== MANIFEST_SCHEMA) throw new Error(`restricted-values manifest schema must be ${MANIFEST_SCHEMA}`);
  const values = document.values ?? [];
  const issuePrefixes = document.issuePrefixes ?? [];
  if (!Array.isArray(values) || !Array.isArray(issuePrefixes) || values.length + issuePrefixes.length > 512) throw new Error("restricted-values manifest arrays are invalid or oversized");
  const normalizedValues = values.map((value) => {
    if (typeof value !== "string" || value.trim().length < 3 || value.trim().length > 200) throw new Error("restricted value has an invalid shape");
    return normalized(value.trim());
  });
  const normalizedPrefixes = issuePrefixes.map((value) => {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(value)) throw new Error("restricted issue prefix has an invalid shape");
    return normalized(value);
  });
  if (new Set(normalizedValues.map((value) => value.toLowerCase())).size !== normalizedValues.length || new Set(normalizedPrefixes.map((value) => value.toLowerCase())).size !== normalizedPrefixes.length) throw new Error("restricted-values manifest contains ambiguous duplicate entries");
  return {
    target,
    patterns: [
      ...normalizedValues.map((value) => ({ category: "restricted-value", pattern: new RegExp(escapeRegex(value), "iu") })),
      ...normalizedPrefixes.map((value) => ({ category: "restricted-issue-id", pattern: new RegExp(`\\b${escapeRegex(value)}-[A-Z0-9][A-Z0-9_-]*\\b`, "iu") })),
    ],
  };
}

function addMatches(findings, patterns, text, surface) {
  const candidate = normalized(text);
  for (const detector of patterns) {
    if (!detector.pattern.test(candidate)) continue;
    findings.push({ surface, category: detector.category, redacted: `[REDACTED:${detector.category.toUpperCase().replace(/-/g, "_")}]` });
    if (findings.length > MAX_FINDINGS) throw new Error("restricted-residue finding bound exceeded");
  }
}

function swapUtf16(bytes) {
  const swapped = Buffer.alloc(bytes.length - (bytes.length % 2));
  for (let index = 0; index < swapped.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return swapped;
}

function decodeUtf32(bytes, littleEndian) {
  let text = "";
  for (let index = 0; index + 3 < bytes.length; index += 4) {
    const value = littleEndian ? bytes.readUInt32LE(index) : bytes.readUInt32BE(index);
    if (value === 0) text += "\0";
    else if (value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) text += String.fromCodePoint(value);
    else text += "\ufffd";
  }
  return text;
}

function decodedCandidates(bytes) {
  const candidates = [];
  try { candidates.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { /* scan other encodings and raw metadata */ }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) candidates.push(bytes.subarray(2).toString("utf16le"));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) candidates.push(swapUtf16(bytes.subarray(2)).toString("utf16le"));
  for (let offset = 0; offset < 2 && offset < bytes.length; offset += 1) {
    const aligned = bytes.subarray(offset, bytes.length - ((bytes.length - offset) % 2));
    candidates.push(aligned.toString("utf16le"));
    candidates.push(swapUtf16(aligned).toString("utf16le"));
  }
  for (let offset = 0; offset < 4 && offset < bytes.length; offset += 1) {
    const aligned = bytes.subarray(offset, bytes.length - ((bytes.length - offset) % 4));
    candidates.push(decodeUtf32(aligned, true));
    candidates.push(decodeUtf32(aligned, false));
  }
  candidates.push(bytes.toString("latin1"));
  return [...new Set(candidates)];
}

function scanBytes(bytes, patterns, surface, location, findings) {
  addMatches(findings, patterns, location, surface);
  for (const text of decodedCandidates(bytes)) {
    addMatches(findings, patterns, text, surface);
    const decodedEscapes = text.replace(/\\\\/g, "\\").replace(/\\\//g, "/");
    if (decodedEscapes !== text) addMatches(findings, patterns, decodedEscapes, surface);
  }
}

function countScanned(counters, bytes) {
  counters.files += 1;
  counters.bytes += bytes;
  if (counters.files > MAX_FILES || counters.bytes > MAX_TOTAL_BYTES) throw new Error("restricted-residue scan exceeded its total bound");
}

function scanFile(target, patterns, surface, location, findings, counters) {
  const input = readBoundedRegularFile(target, MAX_FILE_BYTES);
  countScanned(counters, input.bytes.length);
  scanBytes(input.bytes, patterns, surface, location, findings);
}

function scanDirectory(directory, patterns, surface, findings, counters, ignoredDirectories = new Set()) {
  const root = realpathSync(directory);
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (entry.isSymbolicLink())
        findings.push({
          surface,
          category: "unsafe-symlink",
          redacted: "[REDACTED:UNSAFE_SYMLINK]",
        });
      else if (entry.isDirectory()) {
        addMatches(findings, patterns, relative, surface);
        visit(target);
      } else if (entry.isFile())
        scanFile(target, patterns, surface, relative, findings, counters);
    }
  };
  visit(root);
}

function validTarHeader(header) {
  if (header.length < 512 || header.subarray(0, 512).every((byte) => byte === 0)) return false;
  const stored = Number.parseInt(header.subarray(148, 156).toString("ascii").replace(/\0.*$/, "").trim(), 8);
  if (!Number.isFinite(stored)) return false;
  let calculated = 0;
  for (let index = 0; index < 512; index += 1) calculated += index >= 148 && index < 156 ? 32 : header[index];
  return stored === calculated;
}

function gzipHeaderEnd(buffer, offset) {
  if (offset < 0 || offset + 10 > buffer.length || buffer[offset] !== 0x1f || buffer[offset + 1] !== 0x8b || buffer[offset + 2] !== 0x08) return null;
  const flags = buffer[offset + 3];
  if ((flags & 0xe0) !== 0) return null;
  let cursor = offset + 10;
  const assertHeaderBound = () => {
    if (cursor > buffer.length || cursor - offset > MAX_GZIP_HEADER_BYTES) throw new Error("gzip metadata exceeded its bounded header policy");
  };
  if ((flags & 0x04) !== 0) {
    if (cursor + 2 > buffer.length) throw new Error("gzip extra metadata is truncated");
    const extraLength = buffer.readUInt16LE(cursor);
    cursor += 2 + extraLength;
    assertHeaderBound();
  }
  for (const flag of [0x08, 0x10]) {
    if ((flags & flag) === 0) continue;
    const terminator = buffer.indexOf(0, cursor);
    if (terminator < 0 || terminator - offset >= MAX_GZIP_HEADER_BYTES) throw new Error("gzip text metadata is unterminated or oversized");
    cursor = terminator + 1;
    assertHeaderBound();
  }
  if ((flags & 0x02) !== 0) {
    cursor += 2;
    assertHeaderBound();
  }
  return cursor;
}

function scanGzipMetadata(buffer, patterns, surface, location, findings) {
  const firstEnd = gzipHeaderEnd(buffer, 0);
  if (firstEnd === null) throw new Error("compressed release input has an invalid gzip header");
  let headers = 0;
  const scanHeader = (offset, end) => {
    headers += 1;
    if (headers > MAX_GZIP_HEADERS) throw new Error("gzip metadata header count exceeded its bound");
    scanBytes(buffer.subarray(offset, end), patterns, surface, `${location}:gzip-header`, findings);
  };
  scanHeader(0, firstEnd);
  let searchOffset = firstEnd;
  while (searchOffset + 3 <= buffer.length) {
    const candidate = buffer.indexOf(Buffer.from([0x1f, 0x8b, 0x08]), searchOffset);
    if (candidate < 0) break;
    let end = null;
    try { end = gzipHeaderEnd(buffer, candidate); } catch { /* a compressed byte sequence is not trusted as metadata */ }
    if (end !== null) {
      scanHeader(candidate, end);
      searchOffset = end;
    } else searchOffset = candidate + 3;
  }
}

function parseTar(buffer, patterns, surface, findings, counters, depth = 0, prefix = "archive") {
  if (depth > MAX_ARCHIVE_DEPTH) throw new Error("nested release archive depth exceeded");
  let offset = 0;
  let entries = 0;
  let terminated = false;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (offset + 1024 > buffer.length || !buffer.subarray(offset, offset + 1024).every((byte) => byte === 0) || !buffer.subarray(offset + 1024).every((byte) => byte === 0)) throw new Error("release archive has an invalid terminator or nonzero trailing content");
      terminated = true;
      break;
    }
    if (!validTarHeader(header)) throw new Error("release archive contains an invalid tar header");
    scanBytes(header, patterns, surface, `${prefix}:tar-header`, findings);
    const shortName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const ustarPrefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const name = ustarPrefix ? `${ustarPrefix}/${shortName}` : shortName;
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_EXPANDED_ARCHIVE_BYTES) throw new Error("release archive entry has an invalid size");
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > buffer.length || name.startsWith("/") || name.split(/[\\/]/).includes("..")) throw new Error("release archive entry is truncated or unsafe");
    addMatches(findings, patterns, `${prefix}/${name}`, surface);
    const regularTypes = new Set(["\0", "0", "7"]);
    const metadataTypes = new Set(["x", "g", "L", "K"]);
    if (["1", "2"].includes(type)) findings.push({ surface, category: "unsafe-archive-link", redacted: "[REDACTED:UNSAFE_ARCHIVE_LINK]" });
    else if (type === "5" && size !== 0) throw new Error("release archive directory entries cannot contain payload data");
    else if (type !== "5" && !regularTypes.has(type) && !metadataTypes.has(type)) throw new Error("release archive contains an unsupported special entry type");
    else if (type !== "5") {
      const content = buffer.subarray(contentStart, contentEnd);
      if (content.length > MAX_FILE_BYTES) throw new Error("release archive entry exceeded its byte bound");
      countScanned(counters, content.length);
      if (metadataTypes.has(type)) scanBytes(content, patterns, surface, `${prefix}/${name}:metadata`, findings);
      else if (content[0] === 0x1f && content[1] === 0x8b) {
        scanGzipMetadata(content, patterns, surface, `${prefix}/${name}`, findings);
        const expanded = gunzipSync(content, { maxOutputLength: MAX_EXPANDED_ARCHIVE_BYTES });
        if (expanded.length > MAX_FILE_BYTES) throw new Error("nested compressed archive entry exceeded its expanded byte bound");
        countScanned(counters, expanded.length);
        if (validTarHeader(expanded.subarray(0, 512))) parseTar(expanded, patterns, surface, findings, counters, depth + 1, `${prefix}/${name}`);
        else scanBytes(expanded, patterns, surface, `${prefix}/${name}:expanded`, findings);
      } else if (content[0] === 0x50 && content[1] === 0x4b) throw new Error("unsupported nested archive format rejected closed");
      else if (validTarHeader(content.subarray(0, 512))) parseTar(content, patterns, surface, findings, counters, depth + 1, `${prefix}/${name}`);
      else scanBytes(content, patterns, surface, `${prefix}/${name}`, findings);
    }
    entries += 1;
    if (entries > MAX_FILES) throw new Error("release archive entry bound exceeded");
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  if (entries === 0) throw new Error("release archive must contain at least one valid entry");
  if (!terminated) throw new Error("release archive is missing its zero-block terminator");
}

function scanArchive(file, patterns, surface, findings, counters) {
  const { bytes: source } = readBoundedRegularFile(file, MAX_ARCHIVE_BYTES);
  const compressed = source[0] === 0x1f && source[1] === 0x8b;
  if (compressed) scanGzipMetadata(source, patterns, surface, "archive-container", findings);
  const expanded = compressed ? gunzipSync(source, { maxOutputLength: MAX_EXPANDED_ARCHIVE_BYTES }) : source;
  if (expanded.length > MAX_EXPANDED_ARCHIVE_BYTES || !validTarHeader(expanded.subarray(0, 512))) throw new Error("release archive must be a bounded valid tar or gzip-compressed tar");
  countScanned(counters, expanded.length);
  parseTar(expanded, patterns, surface, findings, counters);
}

function surfaceName(kind, index) { return `${kind}-${index + 1}`; }

export function validateRestrictedResidue(options) {
  const repo = realNonSymlinkPath(options.repo, "directory");
  const manifest = loadManifest(options.manifest, repo);
  const findings = [];
  const counters = { files: 0, bytes: 0 };
  const knowledgeVaults = options.knowledgeVaults.length > 0 ? options.knowledgeVaults : existsSync(path.join(repo, "knowledge")) ? [path.join(repo, "knowledge")] : [];
  const directorySurfaces = [
    { kind: "repository", paths: [repo], ignores: REPOSITORY_IGNORES },
    { kind: "generated-pack", paths: options.generatedPacks, ignores: new Set() },
    { kind: "knowledge-vault", paths: knowledgeVaults, ignores: new Set() },
  ];
  for (const group of directorySurfaces) group.paths.forEach((entry, index) => {
    const target = realNonSymlinkPath(entry, "directory");
    if (target === manifest.target) throw new Error("restricted-values manifest cannot be a scanned surface");
    scanDirectory(target, manifest.patterns, surfaceName(group.kind, index), findings, counters, group.ignores);
  });
  options.releaseArchives.forEach((entry, index) => scanArchive(entry, manifest.patterns, surfaceName("release-archive", index), findings, counters));
  options.generatedPackArchives.forEach((entry, index) => scanArchive(entry, manifest.patterns, surfaceName("generated-pack", options.generatedPacks.length + index), findings, counters));
  options.installedSkillManifests.forEach((entry, index) => {
    const input = readBoundedRegularFile(entry, MAX_MANIFEST_BYTES);
    if (input.real === manifest.target) throw new Error("restricted-values manifest cannot be the installed-skill manifest");
    countScanned(counters, input.bytes.length);
    scanBytes(input.bytes, manifest.patterns, surfaceName("installed-skill-manifest", index), "manifest", findings);
  });
  return { ok: findings.length === 0, gate: "restricted-residue", schema: "valdris.restricted-residue-result.v1", surfaces: 1 + options.generatedPacks.length + options.generatedPackArchives.length + knowledgeVaults.length + options.releaseArchives.length + options.installedSkillManifests.length, scannedFiles: counters.files, scannedBytes: counters.bytes, findings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/restricted-residue-gate.mjs --repo . --manifest /outside/restricted-values.json [--release-archive release.tgz] [--generated-pack dir | --generated-pack-archive pack.tgz] [--knowledge-vault dir] [--installed-skill-manifest manifest.json]");
    return;
  }
  const result = validateRestrictedResidue(args);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  void error;
  console.error(JSON.stringify({ ok: false, gate: "restricted-residue", problems: ["restricted-residue validation failed closed"] }));
  process.exit(1);
});
