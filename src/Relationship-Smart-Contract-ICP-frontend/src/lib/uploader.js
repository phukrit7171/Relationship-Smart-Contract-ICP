import { unwrap } from "./result";

/** Must match `CHUNK_SIZE` in the canister's constants.rs. */
export const CHUNK_SIZE = 256 * 1024;
const MAX_CHUNK_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // A rejected chunk won't become valid on a retry; only transient
      // transport failures are worth waiting out.
      if (error?.name === "CanisterError") throw error;
      if (attempt < MAX_CHUNK_ATTEMPTS) await sleep(400 * attempt);
    }
  }
  throw new Error(`${label} failed after ${MAX_CHUNK_ATTEMPTS} attempts`, {
    cause: lastError,
  });
}

/**
 * Sends a compressed photo, picking the cheapest path that fits.
 *
 * One chunk is by far the common case, and the one-shot endpoint saves three
 * round trips there. Larger photos fan their chunks out in parallel — each
 * chunk is an independent key on the canister, so ordering doesn't matter.
 *
 * @param {(fraction: number) => void} onProgress 0..1
 */
export async function uploadPhoto(actor, { draft, bytes, onProgress }) {
  const total = bytes.length;
  const report = (sent) => onProgress?.(total === 0 ? 1 : sent / total);

  if (total <= CHUNK_SIZE) {
    report(0);
    const meta = unwrap(await actor.upload_photo(draft, bytes));
    report(total);
    return meta;
  }

  const photoId = unwrap(await actor.start_photo_upload(draft));
  const ref = { relationship_id: draft.relationship_id, photo_id: photoId };

  try {
    let sent = 0;
    await Promise.all(
      Array.from({ length: draft.chunk_count }, (_, index) => {
        const slice = bytes.subarray(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        return withRetry(async () => {
          unwrap(
            await actor.put_photo_chunk({
              ...ref,
              chunk_index: index,
              data: slice,
            }),
          );
          sent += slice.length;
          report(sent);
        }, `chunk ${index}`);
      }),
    );
    return unwrap(await actor.finish_photo_upload(ref));
  } catch (error) {
    // Leave no half-written photo behind. If the abort itself fails the
    // canister's stale-upload sweep will collect it within the hour.
    await actor.abort_photo_upload(ref).catch(() => {});
    throw error;
  }
}

/** Splits a compressed image into the draft the canister expects. */
export function buildDraft({
  relationshipId,
  kind,
  caption,
  takenAt,
  image,
}) {
  return {
    relationship_id: relationshipId,
    kind,
    caption,
    taken_at: BigInt(takenAt.getTime()) * 1_000_000n,
    content_type: image.contentType,
    total_bytes: BigInt(image.bytes.length),
    chunk_count: Math.max(1, Math.ceil(image.bytes.length / CHUNK_SIZE)),
    width: image.width,
    height: image.height,
  };
}
