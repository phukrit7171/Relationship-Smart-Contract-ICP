/**
 * Candid `variant { Ok; Err }` handling.
 *
 * @icp-sdk/bindgen@0.3.0 shapes a variant as `{ __kind__, [tag]: value }`, so
 * both the discriminator and the payload are available. The `Ok`/`Err` key
 * check is a fallback for a bindgen version that drops `__kind__`.
 */

/** An `Err` from the canister, carrying the decoded variant. */
export class CanisterError extends Error {
  constructor(err) {
    super(describeError(err));
    this.name = "CanisterError";
    this.kind = err?.__kind__ ?? Object.keys(err ?? {})[0] ?? "Unknown";
    this.detail = err;
  }
}

/** Returns the `Ok` payload, or throws `CanisterError`. */
export function unwrap(result) {
  const kind = result?.__kind__;
  if (kind === "Ok" || (kind === undefined && "Ok" in (result ?? {}))) {
    return result.Ok;
  }
  throw new CanisterError(result?.Err);
}

const MESSAGES = {
  NotAuthenticated: "Sign in with Internet Identity first.",
  NotFound: "This invite link is not valid — it may have been used already, expired, or been cancelled.",
  NotAMember: "This isn't yours to change.",
  SelfProposal: "You can't propose to yourself. Send the link to someone else.",
  RecipientUnavailable: "They're already in a relationship.",
};

function describeError(err) {
  if (!err) return "Something went wrong.";
  if (typeof err === "string") return err;
  const kind = err.__kind__ ?? (typeof err === "object" ? Object.keys(err)[0] : "Unknown");
  const payload = typeof err === "object" ? err[kind] : undefined;

  switch (kind) {
    case "AlreadyInRelationship":
      return "One of you is already in a relationship. End it first.";
    case "DuplicateInvite":
      return "You already have an invite link out. Cancel it before sending a new one.";
    case "TooLong":
      return payload && typeof payload === "object"
        ? `Your ${payload.field ?? "input"} is ${payload.got} characters — the limit is ${payload.limit}.`
        : "Text field exceeds limit.";
    case "InvalidState":
    case "Invalid":
    case "Forbidden":
      return typeof payload === "string" ? payload : (payload ? String(payload) : "Invalid action.");
    case "Internal":
      return `Something went wrong on-chain: ${typeof payload === "string" ? payload : "internal error"}`;
    default:
      return MESSAGES[kind] ?? `Something went wrong (${kind}).`;
  }
}
