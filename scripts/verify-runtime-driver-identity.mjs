#!/usr/bin/env node
import { platform } from "node:os";

import { runtimeDriverLocalIdentity } from "./runtime-driver-state.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const startedAt = Date.now();
const first = runtimeDriverLocalIdentity();
const second = runtimeDriverLocalIdentity();

for (const component of ["host", "hostId", "bootId", "processIdentity"])
  assert(
    typeof first[component] === "string" && first[component].length > 0,
    `runtime-driver ${component} is unavailable`,
  );

assert(first.host === second.host, "runtime-driver host identity is unstable");
assert(
  first.hostId === second.hostId,
  "runtime-driver machine identity is unstable",
);
assert(
  first.bootId === second.bootId,
  "runtime-driver boot identity is unstable",
);
assert(
  first.processIdentity === second.processIdentity,
  "runtime-driver process identity is unstable",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      platform: platform(),
      elapsedMs: Date.now() - startedAt,
      components: ["host", "hostId", "bootId", "processIdentity"],
      valuesRedacted: true,
    },
    null,
    2,
  ),
);
