import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Principal } from "@icp-sdk/core/principal";
import { useAuth } from "../context/AuthContext";
import { useRelationship } from "../context/RelationshipContext";
import { ErrorBanner, Page } from "../components/Layout";
import { unwrap } from "../lib/result";

const MAX_MESSAGE = 500;
const MAX_TITLE = 64;

const DEFAULT_MESSAGE =
  "Every day with you feels like the luckiest day of my life. " +
  "I want to make this official — not just in my heart, but permanently " +
  "recorded on the blockchain, forever. 🌹";

export default function CreateProposal() {
  const { actor } = useAuth();
  const { refresh } = useRelationship();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [pinned, setPinned] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let recipientPrincipal;
      if (pinned) {
        try {
          recipientPrincipal = Principal.fromText(recipient.trim());
        } catch {
          throw new Error("That isn't a valid Principal ID.");
        }
      }
      unwrap(
        await actor.propose({
          recipient: recipientPrincipal,
          pinned,
          message,
          title,
          ttl_seconds: BigInt(days * 24 * 60 * 60),
        }),
      );
      await refresh();
      navigate("/pending");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        💕
      </div>
      <h1 className="title">
        Ask them <span className="title-emoji">💌</span>
      </h1>
      <p className="sub-message">
        You'll get a link to send. Nothing is written on-chain until they
        accept.
      </p>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">What should we call this?</span>
          <input
            type="text"
            value={title}
            maxLength={MAX_TITLE}
            placeholder="Us"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">
            Your message
            <span className="field-count">
              {message.length}/{MAX_MESSAGE}
            </span>
          </span>
          <textarea
            rows={6}
            value={message}
            maxLength={MAX_MESSAGE}
            onChange={(e) => setMessage(e.target.value)}
            required
          />
        </label>

        <label className="field field-inline">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          <span>Only one specific Principal ID may accept</span>
        </label>

        {pinned ? (
          <label className="field">
            <span className="field-label">Their Principal ID</span>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="aaaaa-bbbbb-…"
              required
            />
            <span className="field-hint">
              They'll find this on their own settings page after signing in.
            </span>
          </label>
        ) : (
          <p className="field-hint">
            Anyone holding the link can accept it. That's usually what you want
            — just send it privately.
          </p>
        )}

        <label className="field">
          <span className="field-label">Link expires after</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <button className="accept-btn" type="submit" disabled={busy}>
          {busy ? "Creating the link… ⏳" : "Create the invitation 💌"}
        </button>
      </form>

      <Link className="logout-btn" to="/join">
        Actually, someone sent me a code 🔑
      </Link>
    </Page>
  );
}
