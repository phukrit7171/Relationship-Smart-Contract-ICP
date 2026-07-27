//! Typed errors. Every endpoint returns `Result<T, Err>` rather than trapping,
//! so the frontend can render a real message instead of a rejected call.

use candid::{CandidType, Deserialize, Principal};

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum Err {
    /// Caller is the anonymous principal — sign in with Internet Identity.
    NotAuthenticated,
    /// No such relationship, or an invite code that is wrong, spent or expired.
    /// Deliberately does not distinguish those cases: telling a stranger
    /// "expired" instead of "wrong" confirms the code existed.
    NotFound,
    NotAMember,
    /// You cannot propose to yourself.
    SelfProposal,
    /// The named principal is already in an active relationship.
    AlreadyInRelationship(Principal),
    /// You already have an unclaimed invite out. Cancel it first.
    DuplicateInvite(u64),
    /// The relationship is not in a state where this makes sense.
    InvalidState(String),
    /// A text field is over its character limit.
    TooLong { field: String, limit: u64, got: u64 },
    /// A photo, or a chunk of one, exceeds its size limit.
    TooLarge { limit: u64, got: u64 },
    /// A per-relationship or canister-wide storage limit is reached.
    QuotaExceeded(String),
    /// A chunk that doesn't fit the upload it claims to belong to.
    BadChunk(String),
    UnsupportedContentType(String),
    /// Argument that is malformed rather than merely out of range.
    Invalid(String),
    /// Controller-only endpoint, or an admin action that already ran.
    Forbidden(String),
    /// Something that should not happen did. Reported, not trapped, so state
    /// written before the failure is still visible for debugging.
    Internal(String),
}

pub type Res<T> = Result<T, Err>;

/// `field` names the candid field so the frontend can highlight the right input.
pub fn check_len(field: &str, value: &str, limit: usize) -> Res<()> {
    let got = value.chars().count();
    if got > limit {
        return Err(Err::TooLong {
            field: field.to_string(),
            limit: limit as u64,
            got: got as u64,
        });
    }
    Ok(())
}
