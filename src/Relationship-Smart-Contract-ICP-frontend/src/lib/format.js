/** Timestamp and principal formatting. Canister times are nanoseconds. */

export const NS_PER_MS = 1_000_000n;

export function nsToDate(ns) {
  return new Date(Number(BigInt(ns) / NS_PER_MS));
}

export function nsToDateString(ns) {
  return nsToDate(ns).toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function nsToShortDate(ns) {
  return nsToDate(ns).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function principalText(principal) {
  if (!principal) return "";
  return typeof principal === "string" ? principal : principal.toText();
}

/** Principals are 63 characters — too long to read, so show both ends. */
export function shortPrincipal(principal) {
  const text = principalText(principal);
  if (text.length <= 17) return text;
  return `${text.slice(0, 8)}…${text.slice(-5)}`;
}

/** Rounded "in 3 days" / "in 4 hours", for invite expiry. */
export function relativeFromNow(ns, now = Date.now()) {
  const ms = nsToDate(ns).getTime() - now;
  if (ms <= 0) return "expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
