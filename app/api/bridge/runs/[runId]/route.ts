import {
  bridgeProxyError,
  bridgeProxyProblemResponse,
  bridgeProxyRequestProblem,
  proxyBridge,
} from "../../../../../lib/bridge-proxy";

const DETAIL_QUERY_NAMES = new Set(["eventLimit", "eventCursor"]);

function detailBridgePath(request: Request, runId: string) {
  const searchParams = new URL(request.url).searchParams;
  const unsupported = [
    ...new Set(
      [...searchParams.keys()].filter((name) => !DETAIL_QUERY_NAMES.has(name)),
    ),
  ];
  if (unsupported.length) return { ok: false as const, unsupported };
  const query = searchParams.toString();
  return {
    ok: true as const,
    path: `/runs/${encodeURIComponent(runId)}${query ? `?${query}` : ""}`,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const problem = bridgeProxyRequestProblem(request);
  if (problem) return bridgeProxyProblemResponse(problem);
  try {
    const { runId } = await context.params;
    const target = detailBridgePath(request, runId);
    if (!target.ok) {
      return Response.json(
        {
          ok: false,
          error: "invalid_query",
          problems: target.unsupported.map(
            (name) => `unsupported query parameter: ${name}`,
          ),
        },
        {
          status: 400,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    return await proxyBridge(target.path);
  } catch (error) {
    return bridgeProxyError(error);
  }
}
