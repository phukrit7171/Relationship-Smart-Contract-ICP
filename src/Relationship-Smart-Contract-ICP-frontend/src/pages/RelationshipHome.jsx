import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { usePhotos } from "../context/PhotoContext";
import { Page, Spinner } from "../components/Layout";
import { PrincipalBadge } from "../components/PrincipalBadge";
import { AnniversaryBanner, TogetherSince } from "../components/Anniversary";
import { Timeline } from "../components/Timeline";
import { nsToDateString } from "../lib/format";

export default function RelationshipHome() {
  const { principal } = useAuth();
  const { active, state } = useRelationship();
  const { photos, loading } = usePhotos();

  const partner =
    active.proposer.toText() === principal ? active.recipient : active.proposer;

  return (
    <Page className="accepted">
      <div className="hearts" aria-hidden="true">
        💖💍💖
      </div>
      <h1 className="title">
        {active.title || "It's official"} <span className="title-emoji">🎉</span>
      </h1>

      <AnniversaryBanner
        acceptedAt={active.accepted_at}
        action={
          <Link className="logout-btn" to="/us/upload?kind=Anniversary">
            Add an anniversary photo 📷
          </Link>
        }
      />

      <TogetherSince acceptedAt={active.accepted_at} canisterNow={state?.now} />

      {loading ? (
        <Spinner label="Loading photos…" />
      ) : (
        <Timeline
          relationshipId={active.id}
          photos={photos}
          emptyAction={
            <Link className="accept-btn" to="/us/upload">
              Add the first photo 📷
            </Link>
          }
        />
      )}

      {photos.length > 0 && (
        <Link className="accept-btn" to="/us/upload">
          Add a photo 📷
        </Link>
      )}

      {active.accepted_at != null && (
        <div className="timestamp-box">
          <span className="timestamp-label">💎 Recorded on-chain at</span>
          <span className="timestamp-value">{nsToDateString(active.accepted_at)}</span>
          <span className="timestamp-raw">({active.accepted_at.toString()} ns)</span>
        </div>
      )}

      <PrincipalBadge principal={active.proposer} label="✍️ Asked by" />
      <PrincipalBadge principal={partner} label="✍️ Said yes" />

      <Link className="logout-btn" to="/settings">
        Settings
      </Link>
    </Page>
  );
}
