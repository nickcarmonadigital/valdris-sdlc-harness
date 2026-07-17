import { bridgeProxyError, bridgeProxyProblemResponse, bridgeProxyRequestProblem, proxyBridge, readBoundedBridgeProxyBody } from "../../../../lib/bridge-proxy";

const LIST_QUERY_NAMES = new Set(["limit", "cursor"]);

function listBridgePath(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const unsupported = [...new Set([...searchParams.keys()].filter((name) => !LIST_QUERY_NAMES.has(name)))];
  if (unsupported.length) return { ok: false as const, unsupported };
  const query = searchParams.toString();
  return { ok: true as const, path: `/runs${query ? `?${query}` : ""}` };
}

export async function GET(request: Request) {
  const problem = bridgeProxyRequestProblem(request);
  if (problem) return bridgeProxyProblemResponse(problem);
  try {
    const target = listBridgePath(request);
    if (!target.ok) {
      return Response.json({ ok: false, error: "invalid_query", problems: target.unsupported.map((name) => `unsupported query parameter: ${name}`) }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    return await proxyBridge(target.path);
  } catch (error) {
    return bridgeProxyError(error);
  }
}

export async function POST(request: Request) {
  const problem = bridgeProxyRequestProblem(request, { write: true });
  if (problem) return bridgeProxyProblemResponse(problem);
  try {
    const body = await readBoundedBridgeProxyBody(request);
    if (!body.ok) return bridgeProxyProblemResponse(body.problem);
    return await proxyBridge("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body.body,
    });
  } catch (error) {
    return bridgeProxyError(error);
  }
}
