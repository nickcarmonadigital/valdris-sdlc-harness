const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8787";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const UI_REQUEST_HEADER = "x-uash-ui-request";
const PAGINATION_RESPONSE_HEADERS = Object.freeze([
  "x-uash-page-offset",
  "x-uash-page-limit",
  "x-uash-page-returned",
  "x-uash-page-total",
  "x-uash-next-cursor",
]);
export const BRIDGE_PROXY_MAX_BODY_BYTES = 1024 * 1024;
export const BRIDGE_PROXY_MAX_RESPONSE_BYTES = 1024 * 1024;

export type BridgeProxyRequestProblem = {
  status: 400 | 403 | 413 | 415;
  error: "bridge_proxy_forbidden" | "invalid_request_body" | "payload_too_large" | "unsupported_media_type";
  message: string;
};

export type BridgeProxyBodyResult =
  | { ok: true; body: string }
  | { ok: false; problem: BridgeProxyRequestProblem };

export type BridgeProxyResponseBodyResult =
  | { ok: true; body: Uint8Array<ArrayBuffer> }
  | { ok: false; error: "bridge_proxy_upstream_too_large" | "bridge_proxy_invalid_upstream_response"; message: string };

function isLoopbackHostname(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * The browser-facing proxy deliberately holds a server-side bridge credential.
 * Keep it usable only by the same-origin UI on a loopback-bound Next server.
 */
export function bridgeProxyRequestProblem(request: Request, options: { write?: boolean } = {}): BridgeProxyRequestProblem | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    return {
      status: 403,
      error: "bridge_proxy_forbidden",
      message: "The bridge UI proxy is available only through an HTTP loopback origin.",
    };
  }

  if (request.headers.get(UI_REQUEST_HEADER) !== "1") {
    return {
      status: 403,
      error: "bridge_proxy_forbidden",
      message: `${UI_REQUEST_HEADER} is required for bridge UI proxy requests.`,
    };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return {
      status: 403,
      error: "bridge_proxy_forbidden",
      message: "Cross-site bridge UI proxy requests are not allowed.",
    };
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return {
      status: 403,
      error: "bridge_proxy_forbidden",
      message: "The request Origin must match the loopback UI origin.",
    };
  }

  if (options.write) {
    if (!origin) {
      return {
        status: 403,
        error: "bridge_proxy_forbidden",
        message: "State-changing bridge UI proxy requests require a same-origin Origin header.",
      };
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return {
        status: 415,
        error: "unsupported_media_type",
        message: "State-changing bridge UI proxy requests require application/json.",
      };
    }
  }

  return null;
}

export function bridgeProxyProblemResponse(problem: BridgeProxyRequestProblem) {
  return Response.json({ ok: false, error: problem.error, message: problem.message }, {
    status: problem.status,
    headers: { "cache-control": "no-store" },
  });
}

function bodyProblem(status: 400 | 413): BridgeProxyBodyResult {
  return {
    ok: false,
    problem: status === 413
      ? { status, error: "payload_too_large", message: `Bridge proxy request bodies are limited to ${BRIDGE_PROXY_MAX_BODY_BYTES} bytes.` }
      : { status, error: "invalid_request_body", message: "The bridge proxy request body could not be read safely." },
  };
}

export async function readBoundedBridgeProxyBody(request: Request): Promise<BridgeProxyBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return bodyProblem(400);
    if (BigInt(declaredLength) > BigInt(BRIDGE_PROXY_MAX_BODY_BYTES)) return bodyProblem(413);
  }
  if (!request.body) return { ok: true, body: "" };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return bodyProblem(400);
  }
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > BRIDGE_PROXY_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return bodyProblem(413);
      }
      chunks.push(value);
    }
  } catch {
    return bodyProblem(400);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new TextDecoder().decode(body) };
}

function upstreamResponseProblem(tooLarge: boolean): BridgeProxyResponseBodyResult {
  return tooLarge
    ? { ok: false, error: "bridge_proxy_upstream_too_large", message: `Bridge responses are limited to ${BRIDGE_PROXY_MAX_RESPONSE_BYTES} bytes.` }
    : { ok: false, error: "bridge_proxy_invalid_upstream_response", message: "The bridge returned a response body that could not be read safely." };
}

export async function readBoundedBridgeProxyResponse(response: Response): Promise<BridgeProxyResponseBodyResult> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return upstreamResponseProblem(false);
    if (BigInt(declaredLength) > BigInt(BRIDGE_PROXY_MAX_RESPONSE_BYTES)) return upstreamResponseProblem(true);
  }
  if (!response.body) return { ok: true, body: new Uint8Array(new ArrayBuffer(0)) };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return upstreamResponseProblem(false);
  }
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > BRIDGE_PROXY_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return upstreamResponseProblem(true);
      }
      chunks.push(value);
    }
  } catch {
    return upstreamResponseProblem(false);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(new ArrayBuffer(receivedBytes));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

function bridgeBaseUrl() {
  const parsed = new URL(process.env.UASH_BRIDGE_URL || DEFAULT_BRIDGE_URL);
  if (parsed.protocol !== "http:" || !isLoopbackHostname(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error("UASH_BRIDGE_URL must be a credential-free HTTP loopback URL");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function bridgeAccessToken() {
  const token = process.env.UASH_BRIDGE_ACCESS_TOKEN;
  if (!token) throw new Error("UASH_BRIDGE_ACCESS_TOKEN is required by the local bridge proxy");
  return token;
}

export async function proxyBridge(pathname: string, init: RequestInit = {}) {
  if (!pathname.startsWith("/")) throw new Error("bridge proxy pathname must be absolute");
  const headers = new Headers(init.headers);
  headers.set("x-uash-bridge-token", bridgeAccessToken());
  const response = await fetch(`${bridgeBaseUrl()}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const bounded = await readBoundedBridgeProxyResponse(response);
  if (!bounded.ok) {
    return Response.json({ ok: false, error: bounded.error, message: bounded.message }, {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  const responseHeaders = new Headers({
    "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const name of PAGINATION_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value && /^\d{1,20}$/.test(value)) responseHeaders.set(name, value);
  }
  return new Response(bounded.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export function bridgeProxyError(_error: unknown) {
  return Response.json({ ok: false, error: "bridge_proxy_failed", message: "The local bridge request failed." }, {
    status: 502,
    headers: { "cache-control": "no-store" },
  });
}
