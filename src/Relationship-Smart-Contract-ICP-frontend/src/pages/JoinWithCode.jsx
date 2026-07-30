import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Page } from "../components/Layout";
import { displayCode, normalizeCode } from "../lib/inviteCode";

/**
 * Manual entry for someone who has the code but not the link — read aloud,
 * forwarded as plain text, or a link that got mangled on the way.
 *
 * Nothing is sent from here: a valid code just routes to the same invite page
 * the link opens, so there is one code-handling path rather than two.
 */
export default function JoinWithCode() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);

  const normalized = normalizeCode(raw);
  const problem = !normalized && touched && raw.trim()
    ? "Paste the 10-character code or the full invitation link."
    : null;

  function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (normalized) navigate(`/invite/${normalized}`);
  }

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        💌
      </div>
      <h1 className="title">
        Got a code? <span className="title-emoji">🔑</span>
      </h1>
      <p className="sub-message">
        Paste the full invitation link for the most reliable result, or type
        its 10-character code. Capitals, dashes and spaces don't matter.
      </p>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Invite code or link</span>
          <input
            className="code-input"
            type="text"
            inputMode="latin"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            // A full IC invite URL is considerably longer than the display
            // code. Keep a defensive limit without truncating normal pastes.
            maxLength={512}
            value={raw}
            placeholder="XXXXX-XXXXX or https://…"
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            autoFocus
          />
          {normalized ? (
            <span className="field-hint">Reads as {displayCode(normalized)} ✓</span>
          ) : (
            <span className="field-hint">{problem ?? " "}</span>
          )}
        </label>

        <button className="accept-btn" type="submit" disabled={!normalized}>
          Open the invitation 💌
        </button>
      </form>

      <Link className="logout-btn" to="/">
        Back
      </Link>
    </Page>
  );
}
