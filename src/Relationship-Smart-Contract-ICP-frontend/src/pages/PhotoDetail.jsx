import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { usePhotos } from "../context/PhotoContext";
import { usePhotoBlob } from "../hooks/usePhotoBlob";
import { ErrorBanner, Page, Spinner } from "../components/Layout";
import { unwrap } from "../lib/result";
import { forget } from "../lib/photoCache";
import { nsToDateString, nsToShortDate, shortPrincipal } from "../lib/format";
import { hex } from "../lib/photoCache";

const MAX_CAPTION = 300;

/**
 * Minting is permanent and makes the image public, so the button never fires
 * on a single click — the consequences are spelled out first.
 */
function Keepsake({ meta, busy, confirming, onStart, onCancel, onMint }) {
  if (meta.token_id !== undefined) {
    return (
      <div className="keepsake-box is-minted">
        <span className="timestamp-label">🏅 Keepsake #{meta.token_id.toString()}</span>
        <p className="timestamp-raw">
          Minted as a soulbound token held by both of you. It can't be
          transferred, sold, or deleted — and this photo is publicly viewable.
        </p>
      </div>
    );
  }

  if (meta.kind === "Memory") {
    return null;
  }

  return (
    <div className="keepsake-box">
      <span className="timestamp-label">🏅 Keepsake</span>
      {confirming ? (
        <>
          <p className="timestamp-raw">
            Minting turns this into a soulbound NFT that belongs to both of
            you. Two things are permanent:{" "}
            <strong>this photo becomes publicly viewable to anyone</strong>,
            and it can never be deleted or transferred afterwards.
          </p>
          <div className="share-actions">
            <button className="accept-btn" onClick={onMint} disabled={busy}>
              {busy ? "Minting… ⏳" : "Yes, mint it forever"}
            </button>
            <button className="logout-btn" onClick={onCancel} disabled={busy}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="timestamp-raw">
            Turn this milestone into an on-chain collectible you both hold.
          </p>
          <button className="logout-btn" onClick={onStart}>
            Mint as a keepsake 🏅
          </button>
        </>
      )}
    </div>
  );
}

export default function PhotoDetail() {
  const { photoId } = useParams();
  const { actor, principal } = useAuth();
  const { active } = useRelationship();
  const { photos, refresh } = usePhotos();
  const navigate = useNavigate();

  const meta = photos.find((p) => p.photo_id.toString() === photoId);
  const { url, error: blobError } = usePhotoBlob(active?.id, meta, Boolean(meta));
  const [imgError, setImgError] = useState(false);

  const [caption, setCaption] = useState(meta?.caption ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingMint, setConfirmingMint] = useState(false);

  if (!meta) {
    return (
      <Page>
        <h1 className="title">That photo isn't here</h1>
        <button className="logout-btn" onClick={() => navigate("/us")}>
          Back to the timeline
        </button>
      </Page>
    );
  }

  const isUploader = meta.uploader.toText() === principal;

  async function saveCaption(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A full replace: update_photo takes every editable field, so the
      // unchanged ones are echoed back from the record we already hold.
      unwrap(
        await actor.update_photo({
          relationship_id: active.id,
          photo_id: meta.photo_id,
          caption,
          taken_at: meta.taken_at,
          kind: meta.kind,
        }),
      );
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      unwrap(
        await actor.mint_keepsake({
          relationship_id: active.id,
          photo_id: meta.photo_id,
        }),
      );
      await refresh();
      setConfirmingMint(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this photo? It can't be recovered.")) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(
        await actor.delete_photo({
          relationship_id: active.id,
          photo_id: meta.photo_id,
        }),
      );
      forget(active.id, meta);
      await refresh();
      navigate("/us");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="lightbox">
        {url && !imgError ? (
          <img
            src={url}
            alt={meta.caption || "A photo"}
            onError={() => {
              forget(active?.id, meta);
              setImgError(true);
            }}
          />
        ) : blobError || imgError ? (
          <ErrorBanner
            error={blobError || new Error("Image failed to load in browser.")}
          />
        ) : (
          <Spinner label="Loading the photo…" />
        )}
      </div>

      {editing ? (
        <form className="form" onSubmit={saveCaption}>
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
            />
          </label>
          <button className="accept-btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="logout-btn"
            onClick={() => {
              setCaption(meta.caption);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          {meta.caption && <p className="message">{meta.caption}</p>}
          <button className="logout-btn" onClick={() => setEditing(true)}>
            Edit caption
          </button>
        </>
      )}

      <div className="timestamp-box">
        <span className="timestamp-label">📅 Taken</span>
        <span className="timestamp-value">{nsToShortDate(meta.taken_at)}</span>
        <span className="timestamp-raw">
          Uploaded {nsToDateString(meta.uploaded_at)} by{" "}
          {isUploader ? "you" : shortPrincipal(meta.uploader)}
        </span>
        <span className="timestamp-raw">
          {meta.width}×{meta.height} · {meta.content_type} ·{" "}
          {Math.round(Number(meta.total_bytes) / 1024)} KB
        </span>
        <span className="timestamp-raw">
          sha256 {hex(new Uint8Array(meta.sha256)).slice(0, 16)}… — verified in
          your browser against the hash written on-chain.
        </span>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Keepsake
        meta={meta}
        busy={busy}
        confirming={confirmingMint}
        onStart={() => setConfirmingMint(true)}
        onCancel={() => setConfirmingMint(false)}
        onMint={mint}
      />

      <button className="logout-btn" onClick={() => navigate("/us")}>
        Back to the timeline
      </button>
      {meta.token_id === undefined && (
        <button className="danger-btn" onClick={remove} disabled={busy}>
          Delete this photo
        </button>
      )}
    </Page>
  );
}
