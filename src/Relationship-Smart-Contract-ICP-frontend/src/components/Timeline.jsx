import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePhotoBlob } from "../hooks/usePhotoBlob";
import { forget } from "../lib/photoCache";
import { nsToShortDate } from "../lib/format";

const KIND_BADGE = {
  First: "💍 the day",
  Anniversary: "🎂 anniversary",
  Memory: "",
};

/**
 * Fetches only once the tile is near the viewport.
 *
 * Each photo costs one query per chunk; without this a full timeline would
 * fire hundreds of them the moment the page opened.
 */
function PhotoTile({ relationshipId, meta }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { url, error } = usePhotoBlob(relationshipId, meta, visible);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Start a little early so the image is usually there by the time the
      // tile actually scrolls into view.
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const badge = KIND_BADGE[meta.kind];

  return (
    <li className="timeline-item" ref={ref}>
      <div className="timeline-marker" aria-hidden="true" />
      <Link
        className="timeline-photo"
        to={`/us/photo/${meta.photo_id}`}
        style={{ aspectRatio: `${meta.width} / ${meta.height}` }}
      >
        {url && !imgError ? (
          <img
            src={url}
            alt={meta.caption || "A photo"}
            loading="lazy"
            onError={() => {
              forget(relationshipId, meta);
              setImgError(true);
            }}
          />
        ) : error || imgError ? (
          <span
            className="photo-error"
            title={error?.message || "Image failed to load"}
          >
            ⚠️
          </span>
        ) : (
          <span className="photo-placeholder" aria-hidden="true" />
        )}
      </Link>
      <div className="timeline-meta">
        <span className="timeline-date">{nsToShortDate(meta.taken_at)}</span>
        {badge && <span className="status-chip">{badge}</span>}
        {meta.caption && <p className="timeline-caption">{meta.caption}</p>}
      </div>
    </li>
  );
}

export function Timeline({ relationshipId, photos, emptyAction }) {
  if (photos.length === 0) {
    return (
      <div className="timeline-empty">
        <p className="sub-message">
          No photos yet. The first one is usually the day it started.
        </p>
        {emptyAction}
      </div>
    );
  }

  return (
    <ol className="timeline">
      {photos.map((meta) => (
        <PhotoTile
          key={meta.photo_id.toString()}
          relationshipId={relationshipId}
          meta={meta}
        />
      ))}
    </ol>
  );
}
