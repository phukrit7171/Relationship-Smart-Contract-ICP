import { useState } from "react";
import { principalText, shortPrincipal } from "../lib/format";

/**
 * A principal, abbreviated but copyable. The full text is in the title
 * attribute and one click puts it on the clipboard — nobody reads 63
 * characters off a screen, but they do need to paste them.
 */
export function PrincipalBadge({ principal, label }) {
  const full = principalText(principal);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked outside a secure context; the title attribute
      // still lets the user select the value manually.
    }
  }

  return (
    <div className="principal-box">
      {label && <span className="principal-label">{label}</span>}
      <button
        type="button"
        className="principal-value principal-copy"
        onClick={copy}
        title={full}
      >
        {shortPrincipal(full)}
        <span className="copy-hint">{copied ? " ✓ copied" : " ⧉"}</span>
      </button>
    </div>
  );
}
