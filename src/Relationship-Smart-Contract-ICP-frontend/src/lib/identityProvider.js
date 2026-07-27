/** Internet Identity endpoint. Local replicas provision II under id.ai.localhost. */
export function getIdentityProviderUrl() {
  const host = window.location.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
  return isLocal
    ? "http://id.ai.localhost:8000/authorize"
    : "https://id.ai/authorize";
}

/** Eight hours. Long enough to not re-prompt mid-session, short enough to matter. */
export const SESSION_TTL_NS = BigInt(8) * BigInt(3_600_000_000_000);
