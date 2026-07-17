import { lstatSync, readFileSync } from "node:fs";

export const ROOT_DISCOVERY_LOADER_FILES = Object.freeze(["AGENTS.md", "CLAUDE.md"]);
export const ROOT_LOADER_START = "<!-- valdris-sdlc-harness-loader:start -->";
export const ROOT_LOADER_END = "<!-- valdris-sdlc-harness-loader:end -->";

function assertLoaderFileName(fileName) {
  if (!ROOT_DISCOVERY_LOADER_FILES.includes(fileName)) throw new Error(`unsupported target-root discovery loader: ${fileName}`);
}

export function renderRootDiscoveryLoader(fileName) {
  assertLoaderFileName(fileName);
  const nestedFile = `.valdris-harness/${fileName}`;
  const importLine = fileName === "CLAUDE.md" ? `@${nestedFile}\n\n` : "";
  return `${ROOT_LOADER_START}\n${importLine}## Valdris SDLC Harness discovery\n\nBefore planning, editing, reviewing, or reporting completion in this repository, read and follow \`${nestedFile}\`. Treat \`.valdris-harness/project-adapter.json\` as the repository-specific source of truth and use the committed nested runtime for Valdris commands and gates.\n${ROOT_LOADER_END}\n`;
}

function markerCount(content, marker) {
  return content.split(marker).length - 1;
}

export function validateRootDiscoveryLoaderBytes(bytes, fileName) {
  assertLoaderFileName(fileName);
  const decoded = bytes.toString("utf8");
  if (bytes.includes(0) || !Buffer.from(decoded, "utf8").equals(bytes)) {
    throw new Error(`target-root discovery loader ${fileName} must be UTF-8 text`);
  }

  const content = decoded.replace(/\r\n/g, "\n");
  const startCount = markerCount(content, ROOT_LOADER_START);
  const endCount = markerCount(content, ROOT_LOADER_END);
  const start = content.indexOf(ROOT_LOADER_START);
  const end = content.indexOf(ROOT_LOADER_END);
  if (startCount !== 1 || endCount !== 1 || start > end) {
    throw new Error(`target-root discovery loader ${fileName} must contain exactly one bounded loader block`);
  }
  const actualBlock = content.slice(start, end + ROOT_LOADER_END.length);
  const expectedBlock = renderRootDiscoveryLoader(fileName).trimEnd();
  if (actualBlock !== expectedBlock) {
    throw new Error(`target-root discovery loader ${fileName} bounded loader block does not match the commissioned contract`);
  }
  return bytes;
}

export function validateRootDiscoveryLoaderFile(file, fileName) {
  assertLoaderFileName(fileName);
  let stats;
  try {
    stats = lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`target-root discovery loader ${fileName} is missing`);
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`target-root discovery loader ${fileName} must be a regular file`);
  }
  return validateRootDiscoveryLoaderBytes(readFileSync(file), fileName);
}
