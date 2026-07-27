/**
 * Invite code display and normalisation.
 *
 * Mirrors `invite.rs` on the backend: same alphabet, same look-alike
 * substitutions. Doing it here too means a typo is caught before it costs a
 * round trip, but the backend is still the authority.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LEN = 10;

/** Returns the canonical 10-character code, or null if it can't be one. */
export function normalizeCode(raw) {
  if (!raw) return null;
  let cleaned = String(raw).trim().split(/[?#]/)[0];
  cleaned = cleaned.replace(/[/\.\s]+$/, "");
  let out = "";
  for (const ch of cleaned) {
    if (ch === "-" || ch === " " || ch === "_") continue;
    if (out.length === CODE_LEN) return null;
    let c = ch.toUpperCase();
    if (c === "I" || c === "L") c = "1";
    else if (c === "O") c = "0";
    // U is excluded from the alphabet so it can never be misread as V.
    if (!ALPHABET.includes(c)) return null;
    out += c;
  }
  return out.length === CODE_LEN ? out : null;
}

/** `XXXXX-XXXXX`, the form that goes on screen and into the link. */
export function displayCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return code ?? "";
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

/**
 * The shareable URL.
 *
 * The code lives in the fragment, which browsers never send to the server, so
 * it stays out of boundary-node and proxy access logs.
 */
export function inviteUrl(code, origin = window.location.origin) {
  const cleanOrigin = origin ? String(origin).replace(/\/+$/, "") : "";
  return `${cleanOrigin}/#/invite/${normalizeCode(code) ?? code}`;
}

