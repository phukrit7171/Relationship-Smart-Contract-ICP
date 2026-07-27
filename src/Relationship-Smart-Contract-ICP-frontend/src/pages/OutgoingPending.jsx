import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { ErrorBanner, Page } from "../components/Layout";
import { ShareInvite } from "../components/ShareInvite";
import { PrincipalBadge } from "../components/PrincipalBadge";
import { unwrap } from "../lib/result";
import { relativeFromNow } from "../lib/format";

export default function OutgoingPending() {
  const { actor } = useAuth();
  const { outgoing, refresh } = useRelationship();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await actor.cancel_proposal(outgoing.id));
      await refresh();
      navigate("/new");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        ⏳💌
      </div>
      <h1 className="title">
        {outgoing.title || "Waiting on an answer"}{" "}
        <span className="title-emoji">💭</span>
      </h1>
      <p className="message">{outgoing.message}</p>

      {outgoing.invite_code && (
        <ShareInvite
          code={outgoing.invite_code}
          pinned={outgoing.pinned}
          message={outgoing.message}
        />
      )}

      {outgoing.pinned && outgoing.recipient && (
        <PrincipalBadge principal={outgoing.recipient} label="📬 Addressed to" />
      )}

      {outgoing.expires_at !== undefined && (
        <p className="sub-message">
          Expires in {relativeFromNow(outgoing.expires_at)}.
        </p>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <button className="logout-btn" onClick={cancel} disabled={busy}>
        {busy ? "Cancelling…" : "Cancel this invitation"}
      </button>
    </Page>
  );
}
