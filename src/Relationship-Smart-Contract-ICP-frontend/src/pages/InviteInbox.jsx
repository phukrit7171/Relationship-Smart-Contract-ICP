import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { ErrorBanner, Page } from "../components/Layout";
import { PrincipalBadge } from "../components/PrincipalBadge";
import { unwrap } from "../lib/result";
import { relativeFromNow } from "../lib/format";

/** Pinned invites only. Open links are reachable solely through the link. */
export default function InviteInbox() {
  const { actor } = useAuth();
  const { incoming, refresh } = useRelationship();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  async function respond(id, accept) {
    setBusyId(id);
    setError(null);
    try {
      unwrap(await actor.respond_to_proposal({ relationship_id: id, accept }));
      await refresh();
      if (accept) navigate("/us");
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        📬
      </div>
      <h1 className="title">
        Someone asked <span className="title-emoji">💌</span>
      </h1>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <ul className="invite-list">
        {incoming.map((invite) => (
          <li className="invite-item" key={invite.id.toString()}>
            <h2 className="invite-title">{invite.title || "A question for you"}</h2>
            <p className="message">{invite.message}</p>
            <PrincipalBadge principal={invite.proposer} label="🔑 From" />
            {invite.expires_at !== undefined && (
              <p className="timestamp-raw">
                Expires in {relativeFromNow(invite.expires_at)}
              </p>
            )}
            <div className="share-actions">
              <button
                className="accept-btn"
                onClick={() => respond(invite.id, true)}
                disabled={busyId !== null}
              >
                {busyId === invite.id ? "Recording on-chain… ⏳" : "Yes 💖"}
              </button>
              <button
                className="logout-btn"
                onClick={() => respond(invite.id, false)}
                disabled={busyId !== null}
              >
                No thank you
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button className="logout-btn" onClick={() => navigate("/new")}>
        Ask someone yourself instead
      </button>
    </Page>
  );
}
