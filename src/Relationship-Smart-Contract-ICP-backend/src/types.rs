//! Domain records. These are candid-encoded into stable memory, so adding a
//! non-`opt` field to any of them breaks decoding of every record already
//! written — bump `CURRENT_SCHEMA_VERSION` and write a migration if you must.

use candid::{CandidType, Deserialize, Principal};

#[derive(CandidType, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RelStatus {
    /// An invite is out and nobody has claimed it.
    Pending,
    Active,
    /// The recipient said no.
    Declined,
    /// The proposer withdrew the invite, or it expired.
    Cancelled,
    /// It happened, and then it ended.
    Ended,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Relationship {
    pub id: u64,
    pub proposer: Principal,
    /// `None` while an open invite link is outstanding; set once someone
    /// claims it, or up front when the proposer pins a specific principal.
    pub recipient: Option<Principal>,
    /// Only the named `recipient` may accept.
    pub pinned: bool,
    /// Present only while `Pending`; cleared once the invite is resolved so a
    /// spent code is never displayed as if it still worked.
    pub invite_code: Option<String>,
    pub expires_at: Option<u64>,
    pub status: RelStatus,
    pub message: String,
    pub title: String,
    pub created_at: u64,
    pub responded_at: Option<u64>,
    /// The anniversary anchor. Set on acceptance and never cleared, not even
    /// when the relationship ends — the date still happened.
    pub accepted_at: Option<u64>,
    pub ended_at: Option<u64>,
    pub ended_by: Option<Principal>,
    pub end_reason: String,
    // --- photo bookkeeping, unused until Phase 4 ---
    pub first_photo_id: Option<u64>,
    pub next_photo_id: u64,
    pub photo_count: u32,
    pub bytes_used: u64,
}

impl Relationship {
    pub fn is_member(&self, who: Principal) -> bool {
        self.proposer == who || self.recipient == Some(who)
    }

    /// The other half of an accepted pair, from `who`'s point of view.
    pub fn partner_of(&self, who: Principal) -> Option<Principal> {
        if self.proposer == who {
            self.recipient
        } else if self.recipient == Some(who) {
            Some(self.proposer)
        } else {
            None
        }
    }

    pub fn is_expired(&self, now: u64) -> bool {
        matches!(self.status, RelStatus::Pending)
            && self.expires_at.is_some_and(|exp| exp <= now)
    }
}

#[derive(CandidType, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PhotoKind {
    /// The one taken when they said yes. At most one per relationship, and it
    /// cannot be deleted by the partner while the relationship is active.
    First,
    /// Marks an anniversary; these are what the timeline is really for.
    Anniversary,
    /// Anything else worth keeping.
    Memory,
}

#[derive(CandidType, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PhotoState {
    /// Chunks are still arriving. Doubles as the upload session.
    Uploading,
    Complete,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct PhotoMeta {
    pub photo_id: u64,
    pub relationship_id: u64,
    pub uploader: Principal,
    pub kind: PhotoKind,
    pub caption: String,
    /// When the moment happened, which is not when it was uploaded. This is
    /// the timeline's sort key, so a photo added late still lands in place.
    pub taken_at: u64,
    pub uploaded_at: u64,
    pub content_type: String,
    pub total_bytes: u64,
    pub chunk_count: u32,
    pub received_chunks: u32,
    pub width: u32,
    pub height: u32,
    /// Filled in at finish. The client re-hashes the reassembled bytes and
    /// compares, which is what makes an uncertified query response safe here.
    pub sha256: Vec<u8>,
    pub state: PhotoState,
    /// Set when minted as a keepsake: the photo becomes publicly servable.
    pub is_public: bool,
    pub token_id: Option<u64>,
}

/// The client-declared half of a photo, supplied before any bytes arrive.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct PhotoDraft {
    pub relationship_id: u64,
    pub kind: PhotoKind,
    pub caption: String,
    pub taken_at: u64,
    pub content_type: String,
    pub total_bytes: u64,
    pub chunk_count: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct PhotoRef {
    pub relationship_id: u64,
    pub photo_id: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ChunkRef {
    pub relationship_id: u64,
    pub photo_id: u64,
    pub chunk_index: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ChunkArgs {
    pub relationship_id: u64,
    pub photo_id: u64,
    pub chunk_index: u32,
    pub data: Vec<u8>,
}

/// A full replace of the editable fields, not a sparse patch.
///
/// `opt` fields would be the obvious encoding, but @icp-sdk/bindgen converts
/// an optional record field with `value.x ? some : none` — a truthiness test.
/// An empty caption is falsy, so "clear the caption" would arrive as "leave it
/// alone" and the edit would silently do nothing. Requiring every field makes
/// that class of bug impossible to write.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct PhotoPatch {
    pub relationship_id: u64,
    pub photo_id: u64,
    pub caption: String,
    pub taken_at: u64,
    pub kind: PhotoKind,
}

/// What one signed-in principal needs to render the whole app.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct MyState {
    pub caller: Principal,
    /// Canister time, so the frontend can warn about a badly skewed clock
    /// before it renders a countdown off by hours.
    pub now: u64,
    pub active: Option<Relationship>,
    /// The caller's own unclaimed invite, if any.
    pub outgoing: Option<Relationship>,
    /// Pinned invites addressed to the caller. Open-link invites never appear
    /// here — they are only reachable through the link itself.
    pub incoming: Vec<Relationship>,
    /// Closed relationships, newest first, capped at `MAX_HISTORY_ITEMS`.
    pub history: Vec<Relationship>,
}

/// What someone holding an invite link may see before signing in.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct InvitePreview {
    pub relationship_id: u64,
    pub proposer: Principal,
    pub message: String,
    pub title: String,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub pinned: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ProposeArgs {
    /// `None` mints an open link that anyone holding it can accept.
    pub recipient: Option<Principal>,
    /// Requires `recipient`. Restricts acceptance to that one principal.
    pub pinned: bool,
    pub message: String,
    pub title: String,
    pub ttl_seconds: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct RespondArgs {
    pub relationship_id: u64,
    pub accept: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct EndArgs {
    pub relationship_id: u64,
    pub reason: String,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct SetTitleArgs {
    pub relationship_id: u64,
    pub title: String,
}

/// Re-seeds the one relationship that lived in the pre-stable-memory canister.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct LegacyImportArgs {
    pub proposer: Principal,
    pub recipient: Principal,
    pub accepted_at: u64,
    pub message: String,
    pub title: String,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Stats {
    pub relationships: u64,
    pub active_relationships: u64,
    pub pending_invites: u64,
    pub photos: u64,
    pub bytes_used: u64,
    pub stable_pages: u64,
    pub cycles_balance: candid::Nat,
    pub schema_version: u32,
}

/// The shape the pre-overhaul frontend asks for. Kept so the deployed asset
/// build keeps working in the window between the backend and frontend deploys.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ProposalStatus {
    pub is_accepted: bool,
    pub accepted_time: u64,
    pub accepted_by: Option<Principal>,
}

// --- ICRC-7 (soulbound keepsakes) ---

/// ICRC-1/7 account. Subaccounts are accepted and ignored: these tokens can't
/// move, so there is nothing for a subaccount to distinguish.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Vec<u8>>,
}

/// ICRC-3 metadata value.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum Value {
    Blob(Vec<u8>),
    Text(String),
    Nat(candid::Nat),
    Int(candid::Int),
    Array(Vec<Value>),
    Map(Vec<(String, Value)>),
}

/// Both halves of the couple that minted a token.
///
/// ICRC-7 has exactly one owner per token, but a photo of two people belongs
/// to both. `icrc7_owner_of` reports `proposer` as the canonical owner while
/// `icrc7_tokens_of` and `icrc7_balance_of` answer for either — a deliberate
/// deviation, documented in `icrc7_description`.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TokenPartners {
    pub proposer: Principal,
    pub recipient: Principal,
    pub minted_at: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub token_id: candid::Nat,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferError {
    NonExistingTokenId,
    InvalidRecipient,
    Unauthorized,
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: candid::Nat },
    GenericError { error_code: candid::Nat, message: String },
    GenericBatchError { error_code: candid::Nat, message: String },
}

pub type TransferResult = Result<candid::Nat, TransferError>;

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct SupportedStandard {
    pub name: String,
    pub url: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct Config {
    pub schema_version: u32,
    pub next_relationship_id: u64,
    pub total_photos: u64,
    pub total_bytes: u64,
    pub legacy_imported: bool,
    // Added in v2. See ConfigV1 below for why that needed care.
    pub next_token_id: u64,
    pub total_tokens: u64,
}

/// The v1 shape of [`Config`], kept so a canister written by the previous
/// build can still be read.
///
/// Candid cannot decode a stored record into a struct that gained a
/// non-`opt` field, and the config cell is deserialized inside
/// `StableCell::init` — during `thread_local` setup, before `post_upgrade`
/// runs and long before any `schema_version` check could intervene. The only
/// place to handle it is the `Storable` impl itself.
///
/// Adding a field to any stored record means adding a shape here too.
#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct ConfigV1 {
    pub schema_version: u32,
    pub next_relationship_id: u64,
    pub total_photos: u64,
    pub total_bytes: u64,
    pub legacy_imported: bool,
}

impl From<ConfigV1> for Config {
    fn from(old: ConfigV1) -> Self {
        Config {
            schema_version: old.schema_version,
            next_relationship_id: old.next_relationship_id,
            total_photos: old.total_photos,
            total_bytes: old.total_bytes,
            legacy_imported: old.legacy_imported,
            // No tokens could exist before the field did.
            next_token_id: 1,
            total_tokens: 0,
        }
    }
}
