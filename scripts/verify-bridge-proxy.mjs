import assert from "node:assert/strict";
import {
  BRIDGE_PROXY_MAX_BODY_BYTES,
  BRIDGE_PROXY_MAX_RESPONSE_BYTES,
  bridgeProxyError,
  bridgeProxyRequestProblem,
  proxyBridge,
  readBoundedBridgeProxyBody,
  readBoundedBridgeProxyResponse,
} from "../lib/bridge-proxy.ts";

const UI_HEADER = { "x-uash-ui-request": "1" };

function problem(url, init = {}, options = {}) {
  return bridgeProxyRequestProblem(new Request(url, init), options);
}

assert.equal(problem("http://127.0.0.1:3000/api/bridge/health", {
  headers: { ...UI_HEADER, "sec-fetch-site": "same-origin" },
}), null, "same-origin loopback UI GET should be allowed");

assert.equal(problem("http://localhost:3000/api/bridge/runs", {
  method: "POST",
  headers: {
    ...UI_HEADER,
    origin: "http://localhost:3000",
    "content-type": "application/json; charset=utf-8",
    "sec-fetch-site": "same-origin",
  },
  body: "{}",
}, { write: true }), null, "same-origin loopback JSON POST should be allowed");

assert.equal(problem("http://127.0.0.1:3000/api/bridge/runs")?.status, 403,
  "proxy requests without the UI-only header must fail closed");

assert.equal(problem("http://192.168.1.50:3000/api/bridge/runs", {
  headers: UI_HEADER,
})?.status, 403, "LAN-hosted proxy access must fail closed");

assert.equal(problem("http://127.0.0.1:3000/api/bridge/runs", {
  method: "POST",
  headers: {
    ...UI_HEADER,
    origin: "https://attacker.example",
    "content-type": "text/plain",
    "sec-fetch-site": "cross-site",
  },
  body: "{}",
}, { write: true })?.status, 403, "cross-site simple POST must not reach the privileged proxy");

assert.equal(problem("http://127.0.0.1:3000/api/bridge/runs", {
  method: "POST",
  headers: { ...UI_HEADER, "content-type": "application/json" },
  body: "{}",
}, { write: true })?.status, 403, "write without an Origin header must fail closed");

assert.equal(problem("http://127.0.0.1:3000/api/bridge/runs", {
  method: "POST",
  headers: {
    ...UI_HEADER,
    origin: "http://127.0.0.1:3000",
    "content-type": "text/plain",
    "sec-fetch-site": "same-origin",
  },
  body: "{}",
}, { write: true })?.status, 415, "simple content types must not be rewritten into privileged JSON writes");

const ordinaryBody = await readBoundedBridgeProxyBody(new Request("http://127.0.0.1:3000/api/bridge/runs", {
  method: "POST",
  body: JSON.stringify({ id: "EXAMPLE-PROXY-RUN" }),
}));
assert.deepEqual(ordinaryBody, { ok: true, body: JSON.stringify({ id: "EXAMPLE-PROXY-RUN" }) }, "bounded proxy reader changed an ordinary body");

const declaredOversize = await readBoundedBridgeProxyBody(new Request("http://127.0.0.1:3000/api/bridge/runs", {
  method: "POST",
  headers: { "content-length": String(BRIDGE_PROXY_MAX_BODY_BYTES + 1) },
  body: "{}",
}));
assert.equal(declaredOversize.ok, false, "proxy accepted an oversized declared body");
assert.equal(declaredOversize.problem?.status, 413, "proxy did not reject oversized Content-Length before reading");

const streamedOversize = await readBoundedBridgeProxyBody(new Request("http://127.0.0.1:3000/api/bridge/runs", {
  method: "POST",
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(Math.floor(BRIDGE_PROXY_MAX_BODY_BYTES / 2)));
      controller.enqueue(new Uint8Array(Math.ceil(BRIDGE_PROXY_MAX_BODY_BYTES / 2) + 1));
      controller.close();
    },
  }),
  duplex: "half",
}));
assert.equal(streamedOversize.ok, false, "proxy accepted an oversized streamed body");
assert.equal(streamedOversize.problem?.status, 413, "proxy did not bound streamed request bytes");

const ordinaryResponse = await readBoundedBridgeProxyResponse(new Response(JSON.stringify({ ok: true })));
assert.equal(ordinaryResponse.ok, true, "proxy rejected an ordinary upstream response");
assert.equal(new TextDecoder().decode(ordinaryResponse.body), JSON.stringify({ ok: true }), "proxy changed an ordinary upstream response");

const declaredOversizeResponse = await readBoundedBridgeProxyResponse(new Response("{}", {
  headers: { "content-length": String(BRIDGE_PROXY_MAX_RESPONSE_BYTES + 1) },
}));
assert.equal(declaredOversizeResponse.ok, false, "proxy accepted an oversized declared upstream response");
assert.equal(declaredOversizeResponse.error, "bridge_proxy_upstream_too_large", "proxy misclassified an oversized declared upstream response");

const originalFetch = globalThis.fetch;
const originalAccessToken = process.env.UASH_BRIDGE_ACCESS_TOKEN;
const originalBridgeUrl = process.env.UASH_BRIDGE_URL;
try {
  process.env.UASH_BRIDGE_ACCESS_TOKEN = "synthetic-bridge-proxy-access-token";
  const urlCredential = "VERY_SECRET_PROXY_PASSWORD";
  process.env.UASH_BRIDGE_URL = `http://user:${urlCredential}@127.0.0.1:9`;
  let credentialUrlError;
  try {
    await proxyBridge("/health");
  } catch (error) {
    credentialUrlError = error;
  }
  assert.ok(credentialUrlError instanceof Error, "proxy accepted credentials embedded in UASH_BRIDGE_URL");
  const credentialUrlFailure = bridgeProxyError(credentialUrlError);
  const credentialUrlFailureText = await credentialUrlFailure.text();
  assert.equal(credentialUrlFailure.status, 502, "credential-bearing bridge URL did not fail closed");
  assert.equal(credentialUrlFailureText.includes(urlCredential), false, "proxy error response disclosed a bridge URL credential");
  if (originalBridgeUrl === undefined) delete process.env.UASH_BRIDGE_URL;
  else process.env.UASH_BRIDGE_URL = originalBridgeUrl;

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "x-uash-page-offset": "25",
      "x-uash-next-cursor": "50",
      "x-uash-page-total": "not-a-decimal",
    },
  });
  const paginatedProxyResponse = await proxyBridge("/runs?limit=25&cursor=25");
  assert.equal(paginatedProxyResponse.status, 200, "proxy rejected a bounded paginated bridge response");
  assert.equal(paginatedProxyResponse.headers.get("x-uash-page-offset"), "25", "proxy dropped safe pagination metadata");
  assert.equal(paginatedProxyResponse.headers.get("x-uash-next-cursor"), "50", "proxy dropped the safe next cursor");
  assert.equal(paginatedProxyResponse.headers.has("x-uash-page-total"), false, "proxy forwarded malformed pagination metadata");

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(Math.floor(BRIDGE_PROXY_MAX_RESPONSE_BYTES / 2)));
      controller.enqueue(new Uint8Array(Math.ceil(BRIDGE_PROXY_MAX_RESPONSE_BYTES / 2) + 1));
      controller.close();
    },
  }));
  const oversizedProxyResponse = await proxyBridge("/runs");
  assert.equal(oversizedProxyResponse.status, 502, "proxy did not fail closed on an oversized streamed upstream response");
  assert.equal((await oversizedProxyResponse.json()).error, "bridge_proxy_upstream_too_large", "proxy returned the wrong oversized upstream response error");
} finally {
  globalThis.fetch = originalFetch;
  if (originalAccessToken === undefined) delete process.env.UASH_BRIDGE_ACCESS_TOKEN;
  else process.env.UASH_BRIDGE_ACCESS_TOKEN = originalAccessToken;
  if (originalBridgeUrl === undefined) delete process.env.UASH_BRIDGE_URL;
  else process.env.UASH_BRIDGE_URL = originalBridgeUrl;
}

console.log("bridge proxy verification passed: 5 positive, 11 adversarial cases");
