import { useState } from "react";
import { displayCode, inviteUrl, isLocalInviteOrigin } from "../lib/inviteCode";

/**
 * The invite link, plus the warning that goes with it: for an unpinned invite
 * the link *is* the credential, so anyone who ends up holding it can accept.
 */
export function ShareInvite({ code, pinned, message }) {
  const url = inviteUrl(code);
  const isLocal = isLocalInviteOrigin();
  const [copied, setCopied] = useState(null);

  async function copy(what, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied("failed");
    }
  }

  async function share() {
    if (!navigator.share) return copy("link", url);
    try {
      await navigator.share({ title: "A question for you 💌", text: message, url });
    } catch {
      // The user dismissed the share sheet. Nothing to report.
    }
  }

  return (
    <div className="share-box">
      <span className="principal-label">💌 Your invite link</span>

      <button
        type="button"
        className="invite-code"
        onClick={() => copy("code", displayCode(code))}
        title="Copy the code (use it on this same app deployment)"
      >
        {displayCode(code)}
      </button>

      <div className="share-actions">
        <button type="button" className="accept-btn" onClick={() => copy("link", url)}>
          {copied === "link" ? "Copied ✓" : "Copy link 🔗"}
        </button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button type="button" className="logout-btn" onClick={share}>
            Share…
          </button>
        )}
      </div>

      {copied === "code" && <p className="sub-message">Code copied ✓</p>}
      {copied === "failed" && (
        <p className="sub-message">Couldn't reach the clipboard — copy it by hand.</p>
      )}

      <p className="sub-message">
        Send the full link when possible. A code by itself only works on the app
        deployment where it was created.
      </p>
      {isLocal && (
        <p className="sub-message">
          This is a local development invite. Another device cannot use it on
          the production app; create and share a fresh invite from production.
        </p>
      )}

      <p className="timestamp-raw">
        {pinned
          ? "Only the principal you addressed this to can accept it."
          : "Anyone holding this link can accept it. Send it through a private channel, and cancel it if it goes astray."}
      </p>
    </div>
  );
}
