/**
 * Client-side image compression. No dependencies — `createImageBitmap` and
 * canvas encoding are enough, and an image library would dwarf the rest of
 * the bundle.
 */

/** Must match `MAX_PHOTO_BYTES` in the canister's constants.rs. */
export const MAX_PHOTO_BYTES = 512_000;
/** Aim well under the cap so the canister never has to reject a photo. */
const TARGET_BYTES = 400_000;
const MAX_DIM = 1600;
const ACCEPTED_TYPES = ["image/webp", "image/jpeg", "image/png"];

export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(",");

export class ImageError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = "ImageError";
    this.hint = hint;
  }
}

async function encode(bitmap, width, height, type, quality) {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type, quality });
        if (blob && blob.size > 0) return blob;
      }
    } catch {
      // Fall back to DOM canvas if OffscreenCanvas fails (e.g. iOS WebP support edge cases)
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Could not process image canvas.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob && blob.size > 0
          ? resolve(blob)
          : reject(new ImageError("Encoding failed.")),
      type,
      quality,
    ),
  );
}

/**
 * Shrinks and re-encodes a photo until it fits the budget.
 *
 * Quality drops first — it is much less noticeable than losing pixels — and
 * only once quality bottoms out does the image start scaling down.
 *
 * @returns {Promise<{blob: Blob, bytes: Uint8Array, width: number, height: number, contentType: string}>}
 */
export async function compressImage(file) {
  let bitmap;
  try {
    // `from-image` applies the EXIF orientation, so a portrait photo taken on
    // a phone doesn't arrive sideways. No EXIF library needed.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (cause) {
    throw new ImageError(
      "That image couldn't be read.",
      file.type === "image/heic" || /\.heic$/i.test(file.name)
        ? "iPhones save HEIC by default, which browsers can't decode. Settings → Camera → Formats → Most Compatible."
        : "Try a JPEG, PNG or WebP.",
      { cause },
    );
  }

  try {
    let scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    let quality = 0.85;
    let best = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      // Browsers that can't encode the requested type silently fall back to
      // PNG, which is far bigger — so trust blob.type, not the request.
      const blob = await encode(bitmap, width, height, "image/webp", quality);
      const contentType = ACCEPTED_TYPES.includes(blob.type)
        ? blob.type
        : "image/jpeg";
      const candidate = { blob, width, height, contentType };

      if (!best || blob.size < best.blob.size) best = candidate;
      if (blob.size <= TARGET_BYTES) break;

      if (quality > 0.55) quality -= 0.1;
      else scale *= 0.8;
    }

    if (best.blob.size > MAX_PHOTO_BYTES) {
      throw new ImageError(
        "This image is too detailed to fit under the size limit.",
        "Try cropping it, or exporting a smaller version.",
      );
    }

    return {
      ...best,
      bytes: new Uint8Array(await best.blob.arrayBuffer()),
    };
  } finally {
    // ImageBitmaps hold real decoded memory; without this a few large photos
    // in a row will visibly bloat the tab.
    bitmap.close();
  }
}
