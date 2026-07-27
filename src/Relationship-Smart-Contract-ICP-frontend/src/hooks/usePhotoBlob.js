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

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest));
}

async function fetchBlob(actor, relationshipId, meta) {
  const chunks = await Promise.all(
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

  const bytes = new Uint8Array(Number(meta.total_bytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  // Query responses are not certified, so the hash the canister recorded at
  // upload time is what makes these bytes trustworthy.
  const expected = hex(new Uint8Array(meta.sha256));
  if ((await sha256Hex(bytes)) !== expected) {
    throw new Error("This photo failed its integrity check and was discarded.");
  }

  return new Blob([bytes], { type: meta.content_type });
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
