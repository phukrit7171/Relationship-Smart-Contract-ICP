import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { ErrorBanner, Page } from "../components/Layout";
import { PrincipalBadge } from "../components/PrincipalBadge";
import { unwrap } from "../lib/result";

function formatBytes(bytes) {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export default function Settings() {
  const { actor, principal, signOut } = useAuth();
  const { active, refresh } = useRelationship();
  const navigate = useNavigate();

  const [title, setTitle] = useState(active?.title ?? "");
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    actor
      ?.stats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {
        // Stats are decoration; a failure here should not block the page.
      });
    return () => {
      cancelled = true;
    };
  }, [actor]);

  async function saveTitle(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      unwrap(await actor.set_title({ relationship_id: active.id, title }));
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function endRelationship() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await actor.end_relationship({ relationship_id: active.id, reason }));
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <h1 className="title">Settings</h1>

      <PrincipalBadge principal={principal} label="🔑 Your Principal ID" />
      <p className="field-hint">
        Share this if someone wants to address an invitation to you specifically.
      </p>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {active && (
        <>
          <form className="form" onSubmit={saveTitle}>
            <label className="field">
              <span className="field-label">What you call this</span>
              <input
                type="text"
                value={title}
                maxLength={64}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button className="accept-btn" type="submit" disabled={busy}>
              {saved ? "Saved ✓" : busy ? "Saving…" : "Save"}
            </button>
          </form>

          <div className="danger-zone">
            {confirmingEnd ? (
              <>
                <p className="sub-message">
                  This ends the relationship for both of you. The record and its
                  date stay on-chain — nothing is erased.
                </p>
                <label className="field">
                  <span className="field-label">Reason (optional)</span>
                  <input
                    type="text"
                    value={reason}
                    maxLength={300}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="danger-btn" onClick={endRelationship} disabled={busy}>
                  {busy ? "Ending…" : "Yes, end it"}
                </button>
                <button className="logout-btn" onClick={() => setConfirmingEnd(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button className="danger-btn" onClick={() => setConfirmingEnd(true)}>
                End this relationship
              </button>
            )}
          </div>
        </>
      )}

      {stats && (
        <div className="timestamp-box">
          <span className="timestamp-label">📊 This canister</span>
          <span className="timestamp-raw">
            {stats.active_relationships.toString()} active ·{" "}
            {stats.relationships.toString()} total ·{" "}
            {stats.photos.toString()} photos · {formatBytes(stats.bytes_used)} ·{" "}
            {((Number(stats.stable_pages) * 65536) / 1024 ** 2).toFixed(1)} MB stable
          </span>
        </div>
      )}

      <Link className="logout-btn" to="/history">
        Past relationships
      </Link>
      <button className="logout-btn" onClick={signOut}>
        Logout
      </button>
    </Page>
  );
}
