import { timingSafeEqual } from "node:crypto";

export const BRIDGE_CREDENTIAL_ENV_NAMES = Object.freeze([
  "UASH_BRIDGE_INTEGRITY_KEY",
  "UASH_BRIDGE_ACCESS_TOKEN",
  "UASH_HUMAN_APPROVAL_TOKEN",
]);

function secretEqual(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function assertPairwiseDistinctBridgeCredentials(credentials) {
  const entries = BRIDGE_CREDENTIAL_ENV_NAMES.map((name) => [
    name,
    credentials[name],
  ]);
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const [leftName, leftValue] = entries[leftIndex];
      const [rightName, rightValue] = entries[rightIndex];
      if (secretEqual(leftValue, rightValue)) {
        throw new Error(
          `bridge credentials must be pairwise distinct: ${leftName} and ${rightName} must not reuse a value`,
        );
      }
    }
  }
}

export function finishLineChildEnv(environment = process.env) {
  const childEnvironment = { ...environment };
  const credentialNames = new Set(
    BRIDGE_CREDENTIAL_ENV_NAMES.map((name) => name.toUpperCase()),
  );
  for (const name of Object.keys(childEnvironment)) {
    if (credentialNames.has(name.toUpperCase())) delete childEnvironment[name];
  }
  return childEnvironment;
}
