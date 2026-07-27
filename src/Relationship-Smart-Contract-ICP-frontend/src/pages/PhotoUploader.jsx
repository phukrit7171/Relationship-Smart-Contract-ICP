import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { usePhotos } from "../context/PhotoContext";
import { ErrorBanner, Page } from "../components/Layout";
import { ACCEPT_ATTRIBUTE, compressImage } from "../lib/image";
import { buildDraft, uploadPhoto } from "../lib/uploader";
import { anniversaryInfo } from "../lib/anniversary";

const MAX_CAPTION = 300;

function toDateInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatKB(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

export default function PhotoUploader() {
  const { actor } = useAuth();
  const { active } = useRelationship();
  const { photos, refresh } = usePhotos();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const hasFirst = photos.some((p) => p.kind === "First");
  // Arriving from the anniversary banner pre-selects the kind and dates the
  // photo to the anniversary, so a late upload still sorts into place.
  const suggestAnniversary = params.get("kind") === "Anniversary";
  const anniversary = active?.accepted_at
    ? anniversaryInfo(active.accepted_at)
    : null;

  const [kind, setKind] = useState(
    suggestAnniversary ? "Anniversary" : hasFirst ? "Memory" : "First",
  );
  const [takenAt, setTakenAt] = useState(() =>
    toDateInput(
      suggestAnniversary && anniversary?.isToday
        ? anniversary.nextAnniversary
        : new Date(),
    ),
  );
  const [caption, setCaption] = useState("");
  const [image, setImage] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  async function pick(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (image?.previewUrl) {
      URL.revokeObjectURL(image.previewUrl);
    }
    setImage(null);
    setPreparing(true);
    try {
      const compressed = await compressImage(file);
      setImage({
        ...compressed,
        previewUrl: URL.createObjectURL(compressed.blob),
        originalBytes: file.size,
      });
    } catch (err) {
      setError(err);
    } finally {
      setPreparing(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!image) return;
    setError(null);
    setProgress(0);
    try {
      await uploadPhoto(actor, {
        draft: buildDraft({
          relationshipId: active.id,
          kind,
          caption,
          // Midday local time, so a timezone shift can't move the photo to
          // the day before on someone else's screen.
          takenAt: new Date(`${takenAt}T12:00:00`),
          image,
        }),
        bytes: image.bytes,
        onProgress: setProgress,
      });
      await refresh();
      navigate("/us");
    } catch (err) {
      setError(err);
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <Page>
      <h1 className="title">Add a photo</h1>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Photo</span>
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            onChange={pick}
            disabled={uploading}
          />
          <span className="field-hint">
            Resized and re-compressed in your browser before it's sent —
            usually to well under 400 KB.
          </span>
        </label>

        {preparing && <p className="sub-message">Compressing…</p>}

        {image && (
          <div className="upload-preview">
            <img src={image.previewUrl} alt="" />
            <span className="timestamp-raw">
              {image.width}×{image.height} · {formatKB(image.originalBytes)} →{" "}
              {formatKB(image.bytes.length)} · {image.contentType}
            </span>
          </div>
        )}

        <label className="field">
          <span className="field-label">What is this?</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={uploading}
          >
            <option value="First" disabled={hasFirst}>
              💍 The day it started{hasFirst ? " (already set)" : ""}
            </option>
            <option value="Anniversary">🎂 An anniversary</option>
            <option value="Memory">📷 Just a memory</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">When was it taken?</span>
          <input
            type="date"
            value={takenAt}
            onChange={(e) => setTakenAt(e.target.value)}
            disabled={uploading}
          />
          <span className="field-hint">
            This is what the timeline sorts by, not when you upload it.
          </span>
        </label>

        <label className="field">
          <span className="field-label">
            Caption
            <span className="field-count">
              {caption.length}/{MAX_CAPTION}
            </span>
          </span>
          <input
            type="text"
            value={caption}
            maxLength={MAX_CAPTION}
            onChange={(e) => setCaption(e.target.value)}
            disabled={uploading}
          />
        </label>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {error?.hint && <p className="field-hint">{error.hint}</p>}

        {uploading && (
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        <button className="accept-btn" type="submit" disabled={!image || uploading}>
          {uploading ? "Writing it on-chain… ⏳" : "Save it forever 💾"}
        </button>
      </form>

      <button
        className="logout-btn"
        onClick={() => navigate("/us")}
        disabled={uploading}
      >
        Cancel
      </button>
    </Page>
  );
}
