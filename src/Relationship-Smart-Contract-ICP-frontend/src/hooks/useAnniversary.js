import { useEffect, useState } from "react";
import { anniversaryInfo } from "../lib/anniversary";

/**
 * Recomputes the anniversary figures on a ticking clock.
 *
 * @param {bigint} acceptedAtNs
 * @param {number} intervalMs how often to re-tick; 1s for a live countdown,
 *   longer where only the day matters.
 */
export function useAnniversary(acceptedAtNs, intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (acceptedAtNs === undefined) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [acceptedAtNs, intervalMs]);

  if (acceptedAtNs === undefined) return null;
  return { ...anniversaryInfo(acceptedAtNs, now), now };
}
