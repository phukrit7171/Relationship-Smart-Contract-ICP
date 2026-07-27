/**
 * Two-level cache for reassembled photos.
 *
 * Photos are fetched chunk-by-chunk through authenticated queries, so the
 * browser's HTTP cache never sees them. Without this, scrolling the timeline
 * would re-download every photo on every visit.
 *
 * Keys include the content hash, so an edited photo can never be served from
 * a stale entry — and old entries simply stop being asked for.
 */

const CACHE_NAME = "relationship-photos-v1";

/** Object URLs, alive for the session. */
const memory = new Map();

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cacheKey(relationshipId, meta) {
  return `/photo/${relationshipId}/${meta.photo_id}/${hex(new Uint8Array(meta.sha256))}`;
}

export function getMemory(relationshipId, meta) {
  return memory.get(cacheKey(relationshipId, meta));
}

export function putMemory(relationshipId, meta, objectUrl) {
  memory.set(cacheKey(relationshipId, meta), objectUrl);
}

export async function getPersisted(relationshipId, meta) {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKey(relationshipId, meta));
    return hit ? hit.blob() : null;
  } catch {
    // Cache API is unavailable in some private-browsing modes. Not fatal.
    return null;
  }
}

export async function putPersisted(relationshipId, meta, blob) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      cacheKey(relationshipId, meta),
      new Response(blob, { headers: { "Content-Type": meta.content_type } }),
    );
  } catch {
    // Quota exceeded, most likely. The in-memory cache still applies.
  }
}

export function forget(relationshipId, meta) {
  const key = cacheKey(relationshipId, meta);
  const url = memory.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    memory.delete(key);
  }
  if (typeof caches !== "undefined") {
    caches.open(CACHE_NAME).then((cache) => cache.delete(key)).catch(() => {});
  }
}

/** Releases every object URL. Called when the identity changes. */
export function clearAll() {
  for (const url of memory.values()) URL.revokeObjectURL(url);
  memory.clear();
  if (typeof caches !== "undefined") {
    caches.delete(CACHE_NAME).catch(() => {});
  }
}
