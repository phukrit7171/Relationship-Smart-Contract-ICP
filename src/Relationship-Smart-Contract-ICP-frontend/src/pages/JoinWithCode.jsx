import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Page } from "../components/Layout";
import { CODE_LEN, displayCode, normalizeCode } from "../lib/inviteCode";

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
  // Anything that isn't a code character is dropped by normalizeCode, so
  // count what survived to tell "too short" apart from "wrong characters".
  const kept = raw.replace(/[-\s_]/g, "").length;
  const problem = !normalized && touched && kept > 0
    ? kept < CODE_LEN
      ? `${CODE_LEN - kept} more character${CODE_LEN - kept === 1 ? "" : "s"} to go`
      : "That doesn't look like an invite code."
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
        Type the code someone sent you. Capitals, dashes and spaces don't
        matter.
      </p>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Invite code</span>
          <input
            className="code-input"
            type="text"
            inputMode="latin"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            // Room for the two look-alike characters that get rewritten
            // (I/L and O) plus the dash, so nothing is silently swallowed.
            maxLength={CODE_LEN + 4}
            value={raw}
            placeholder="XXXXX-XXXXX"
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
