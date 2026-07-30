import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { unwrap } from "../lib/result";
import {
  getMemory,
  getPersisted,
  hex,
  putMemory,
  putPersisted,
} from "../lib/photoCache";

function jsSha256Hex(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  const padLen = l % 64 < 56 ? 56 - (l % 64) : 120 - (l % 64);
  const padded = new Uint8Array(l + padLen + 8);
  padded.set(bytes);
  padded[l] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen & 0xffffffff, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Int32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getInt32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 =
        ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^
        ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^
        (w[j - 15] >>> 3);
      const s1 =
        ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^
        ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^
        (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 =
        ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const res = new Uint8Array(32);
  const outView = new DataView(res.buffer);
  outView.setInt32(0, h0, false); outView.setInt32(4, h1, false);
  outView.setInt32(8, h2, false); outView.setInt32(12, h3, false);
  outView.setInt32(16, h4, false); outView.setInt32(20, h5, false);
  outView.setInt32(24, h6, false); outView.setInt32(28, h7, false);
  return hex(res);
}

async function sha256Hex(bytes) {
  if (
    typeof crypto !== "undefined" &&
    crypto?.subtle &&
    typeof crypto.subtle.digest === "function"
  ) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return hex(new Uint8Array(digest));
    } catch {
      // Fallback if SubtleCrypto fails
    }
  }
  return jsSha256Hex(bytes);
}

async function fetchBlob(actor, relationshipId, meta) {
  let chunks;
  try {
    chunks = await Promise.all(
      Array.from({ length: meta.chunk_count }, (_, index) =>
        actor
          .get_photo_chunk({
            relationship_id: relationshipId,
            photo_id: meta.photo_id,
            chunk_index: index,
          })
          .then((res) => new Uint8Array(unwrap(res))),
      ),
    );
  } catch (err) {
    console.error("[fetchBlob] get_photo_chunk failed:", err);
    throw err;
  }

  const bytes = new Uint8Array(Number(meta.total_bytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  const expected = hex(new Uint8Array(meta.sha256));
  if (expected && expected.length === 64) {
    const actual = await sha256Hex(bytes);
    if (actual !== expected) {
      console.error("[fetchBlob] Hash mismatch:", { expected, actual });
      throw new Error(
        `Integrity check failed (${actual.slice(0, 8)} != ${expected.slice(0, 8)})`,
      );
    }
  }

  return new Blob([bytes], { type: meta.content_type || "image/jpeg" });
}

/**
 * Resolves a photo to an object URL, checking both caches first.
 *
 * @param {boolean} enabled pass false until the tile is on screen — a
 *   200-photo timeline would otherwise fire hundreds of queries at once.
 */
export function usePhotoBlob(relationshipId, meta, enabled = true) {
  const { actor } = useAuth();
  const photoId = meta?.photo_id;

  const [url, setUrl] = useState(() =>
    meta ? (getMemory(relationshipId, meta) ?? null) : null,
  );
  const [error, setError] = useState(null);

  useEffect(() => {
    setUrl(meta ? (getMemory(relationshipId, meta) ?? null) : null);
    setError(null);
  }, [relationshipId, photoId]);

  useEffect(() => {
    if (!enabled || !actor || !meta) return;
    const cachedUrl = getMemory(relationshipId, meta);
    if (cachedUrl) {
      setUrl(cachedUrl);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        let blob = await getPersisted(relationshipId, meta);
        if (!blob) {
          blob = await fetchBlob(actor, relationshipId, meta);
          await putPersisted(relationshipId, meta, blob);
        }
        if (cancelled) return;
        const existing = getMemory(relationshipId, meta);
        if (existing) {
          setUrl(existing);
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        putMemory(relationshipId, meta, objectUrl);
        setUrl(objectUrl);
      } catch (err) {
        console.error("[usePhotoBlob] Error loading photo:", err);
        if (!cancelled) setError(err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Object URLs are owned by photoCache, not by this hook, so they are
    // deliberately not revoked on unmount — the next tile for the same photo
    // reuses them. photoCache.clearAll() releases them on sign-out.
  }, [actor, relationshipId, photoId, enabled]);

  return { url, error };
}
