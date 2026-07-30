/**
 * Invite code display and normalisation.
 *
 * The canonicalisation step mirrors `invite.rs` on the backend: same alphabet,
 * same look-alike substitutions. The client additionally extracts codes from
 * full invite links and removes common copy/paste artefacts before sending the
 * canonical 10 characters to the backend.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LEN = 10;
const INVITE_PATH = /(?:^|[/#])invite\/([^/?#\s]+)/iu;
const UNICODE_DASH = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/gu;
const EDGE_PUNCTUATION = new Set([
  "\"",
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "/",
  "\\",
]);

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripEdgePunctuation(value) {
  let start = 0;
  let end = value.length;
  while (start < end && EDGE_PUNCTUATION.has(value[start])) start += 1;
  while (end > start && EDGE_PUNCTUATION.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

function inviteCandidate(raw) {
  if (!raw) return "";
  const cleaned = String(raw)
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(UNICODE_DASH, "-")
    .trim();
  const fromLink = cleaned.match(INVITE_PATH)?.[1];
  const candidate = fromLink ?? cleaned.split(/[?#]/u)[0];
  return stripEdgePunctuation(decodeUrlComponent(candidate).trim());
}

/** Returns the canonical 10-character code, or null if it can't be one. */
export function normalizeCode(raw) {
  const cleaned = inviteCandidate(raw);
  if (!cleaned) return null;
  let out = "";
  for (const ch of cleaned) {
    if (ch === "-" || ch === "_" || /\s/u.test(ch)) continue;
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

/** True when an invite link points at a development network on this machine/LAN. */
export function isLocalInviteOrigin(origin = window.location.origin) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./u.test(hostname)
    );
  } catch {
    return false;
  }
}
