import { bridgeProxyError, bridgeProxyProblemResponse, bridgeProxyRequestProblem, proxyBridge } from "../../../../lib/bridge-proxy";

export async function GET(request: Request) {
  const problem = bridgeProxyRequestProblem(request);
  if (problem) return bridgeProxyProblemResponse(problem);
  try {
    return await proxyBridge("/health");
  } catch (error) {
    return bridgeProxyError(error);
  }
}
