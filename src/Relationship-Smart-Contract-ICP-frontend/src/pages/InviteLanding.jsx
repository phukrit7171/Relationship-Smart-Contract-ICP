import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { ErrorBanner, Page, Spinner } from "../components/Layout";
import { PrincipalBadge } from "../components/PrincipalBadge";
import { unwrap } from "../lib/result";
import { normalizeCode } from "../lib/inviteCode";
import { relativeFromNow } from "../lib/format";

/**
 * Internet Identity redirects back to a bare origin, losing the route. Stash
 * the code before signing in so the flow can be resumed on the way back
 * instead of dumping the visitor on the "create a proposal" screen.
 */
const PENDING_KEY = "pendingInviteCode";

export function consumePendingInviteCode() {
  const code = sessionStorage.getItem(PENDING_KEY);
  if (code) sessionStorage.removeItem(PENDING_KEY);
  return code;
}

export default function InviteLanding() {
  const { code: rawCode } = useParams();
  const navigate = useNavigate();
  const { actor, isAuthenticated, signIn, principal } = useAuth();
  const { refresh } = useRelationship();

  const code = normalizeCode(rawCode);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!actor) return;
    // Clear first: without this, following a second link would show the
    // previous invitation's message under a "not valid" error.
    setPreview(null);
    setError(null);
    if (!code) {
      setError(new Error("That doesn't look like an invite code."));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    actor
      .get_invite_preview(code)
      .then((res) => !cancelled && setPreview(unwrap(res)))
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [actor, code]);

  const accept = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      unwrap(await actor.accept_invite(code));
      await refresh();
      navigate("/us", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [actor, code, navigate, refresh]);

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await actor.decline_invite(code));
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function loginThenAccept() {
    sessionStorage.setItem(PENDING_KEY, code);
    try {
      await signIn();
      // The auth state change re-renders this page with the accept button live.
    } catch (err) {
      sessionStorage.removeItem(PENDING_KEY);
      setError(err);
    }
  }

  if (loading) {
    return (
      <Page>
        <Spinner />
        <p className="subtitle">Opening the invitation…</p>
      </Page>
    );
  }

  if (!preview) {
    return (
      <Page>
        <div className="hearts" aria-hidden="true">
          🕊️
        </div>
        <h1 className="title">This link doesn't work</h1>
        <p className="message">
          Open the original full link and make sure both people use the same app
          address. This invitation may also have been accepted, cancelled, or
          expired.
        </p>
        <ErrorBanner error={error} />
        {/* A mangled link is the likeliest cause, so offer retyping the code
            before sending them back to the start. */}
        <button className="accept-btn" onClick={() => navigate("/join")}>
          Type the code instead 🔑
        </button>
        <button className="logout-btn" onClick={() => navigate("/")}>
          Go to the start
        </button>
      </Page>
    );
  }

  const isProposer = isAuthenticated && principal === preview.proposer.toText();

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        💌
      </div>
      <h1 className="title">
        {preview.title || "Someone has a question"}{" "}
        <span className="title-emoji">💕</span>
      </h1>
      <p className="message">{preview.message}</p>

      <PrincipalBadge principal={preview.proposer} label="🔑 Asked by" />

      {preview.expires_at !== undefined && (
        <p className="sub-message">
          This invitation expires in {relativeFromNow(preview.expires_at)}.
        </p>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {isProposer ? (
        <p className="sub-message">
          This is your own invitation — send the link to the other person.
        </p>
      ) : isAuthenticated ? (
        <>
          <p className="sub-message">
            Accepting writes both of your Principal IDs on-chain, permanently.
          </p>
          <button className="accept-btn" onClick={accept} disabled={busy}>
            {busy ? "Recording on-chain… ⏳" : "Yes 💖"}
          </button>
          <button className="logout-btn" onClick={decline} disabled={busy}>
            No thank you
          </button>
        </>
      ) : (
        <>
          <p className="sub-message">
            Sign in to answer. Your Principal ID becomes the proof that it was
            you who said yes.
          </p>
          <button className="login-btn" onClick={loginThenAccept}>
            Sign in to answer 🌐
          </button>
        </>
      )}
    </Page>
  );
}
