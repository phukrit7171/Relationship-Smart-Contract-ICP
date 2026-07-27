//! Relationship smart contract.
//!
//! Two people sign in with Internet Identity: one sends an invite link, the
//! other opens it and accepts. Both principals are recorded, in stable memory,
//! and survive canister upgrades.
//!
//! This file holds only the candid surface. The logic lives in `relationship`,
//! `invite` and `admin`; the storage contract is documented in `memory`.

mod admin;
mod constants;
mod errors;
mod invite;
mod memory;
mod nft;
mod photo;
mod relationship;
mod serve;
mod sha256;
mod storable;
mod types;

use candid::Nat;
use constants::CURRENT_SCHEMA_VERSION;
use errors::{Err, Res};
use ic_cdk::management_canister::raw_rand;
use ic_http_certification::{HttpRequest, HttpResponse};
use types::*;

// --- lifecycle ---

#[ic_cdk::init]
fn init() {
    memory::update_config(|c| {
        c.schema_version = CURRENT_SCHEMA_VERSION;
        c.next_relationship_id = 1;
        c.next_token_id = 1;
    });
    serve::rebuild();
}

/// Does not move data: `MemoryManager` already keeps everything in stable
/// memory. See the module docs in `memory` for why there is no `pre_upgrade`.
#[ic_cdk::post_upgrade]
fn post_upgrade() {
    let version = memory::config().schema_version;
    assert!(
        version <= CURRENT_SCHEMA_VERSION,
        "stored schema v{version} is newer than this wasm (v{CURRENT_SCHEMA_VERSION}); \
         downgrades are not supported"
    );
    if version < CURRENT_SCHEMA_VERSION {
        // v0 is a canister installed before the config cell existed.
        memory::update_config(|c| {
            if c.next_relationship_id == 0 {
                c.next_relationship_id = 1;
            }
            if c.next_token_id == 0 {
                c.next_token_id = 1;
            }
            c.schema_version = CURRENT_SCHEMA_VERSION;
        });
    }
    // The certification tree lives in the heap and does not survive an
    // upgrade. Without this every public photo would start failing response
    // verification at the boundary node.
    serve::rebuild();
}

// --- handshake ---

/// Creates a proposal and mints the invite code to share.
///
/// Async because the code comes from `raw_rand` — a time- or counter-derived
/// code would be guessable, and the code is the only thing standing between a
/// stranger and someone's proposal. Preconditions are checked twice: once here
/// to fail fast, and again after the await, where the canister may have
/// processed other messages in between.
#[ic_cdk::update]
async fn propose(args: ProposeArgs) -> Res<Relationship> {
    let caller = relationship::authenticated_caller()?;
    relationship::precheck_propose(caller, &args)?;

    let entropy = raw_rand()
        .await
        .map_err(|e| Err::Internal(format!("raw_rand failed: {e}")))?;

    relationship::finish_propose(caller, args, &entropy)
}

/// Reads an invite without signing in, so someone opening a link can see what
/// they are being asked before deciding to authenticate.
///
/// Anyone holding the code can read the message. That is inherent to a
/// shareable link; pin the invite to a principal if it matters.
#[ic_cdk::query]
fn get_invite_preview(code: String) -> Res<InvitePreview> {
    relationship::preview(&code)
}

#[ic_cdk::update]
fn accept_invite(code: String) -> Res<Relationship> {
    let caller = relationship::authenticated_caller()?;
    relationship::accept_by_code(caller, &code)
}

#[ic_cdk::update]
fn decline_invite(code: String) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    relationship::decline_by_code(caller, &code)
}

/// Responds to a pinned invite found in your inbox. Open links go through
/// `accept_invite`/`decline_invite` instead.
#[ic_cdk::update]
fn respond_to_proposal(args: RespondArgs) -> Res<Relationship> {
    let caller = relationship::authenticated_caller()?;
    relationship::respond(caller, args)
}

/// Withdraws your own unclaimed invite and frees the code.
#[ic_cdk::update]
fn cancel_proposal(relationship_id: u64) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    relationship::cancel(caller, relationship_id)
}

/// Ends an active relationship. Either partner may do this alone.
#[ic_cdk::update]
fn end_relationship(args: EndArgs) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    relationship::end(caller, args)
}

#[ic_cdk::update]
fn set_title(args: SetTitleArgs) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    relationship::set_title(caller, args)
}

// --- reads ---

/// Everything the signed-in principal needs to render the app. Returns an
/// empty state for anonymous callers rather than an error, because this backs
/// the first page load.
#[ic_cdk::query]
fn get_my_state() -> MyState {
    relationship::my_state()
}

#[ic_cdk::query]
fn get_relationship(relationship_id: u64) -> Res<Relationship> {
    let caller = relationship::authenticated_caller()?;
    relationship::get_for_member(caller, relationship_id)
}

/// Deprecated. Serves the pre-overhaul frontend during the deploy window; drop
/// it once the new asset build is live on every environment.
#[ic_cdk::query]
fn get_status() -> ProposalStatus {
    relationship::legacy_status()
}

// --- photos ---

/// start + chunk + finish in one call, for a photo that fits in one chunk.
///
/// Compressed photos almost always do, and this saves three round trips —
/// roughly eight seconds of the user staring at a spinner.
#[ic_cdk::update]
fn upload_photo(draft: PhotoDraft, bytes: Vec<u8>) -> Res<PhotoMeta> {
    let caller = relationship::authenticated_caller()?;
    photo::upload_one_shot(caller, draft, bytes)
}

#[ic_cdk::update]
fn start_photo_upload(draft: PhotoDraft) -> Res<u64> {
    let caller = relationship::authenticated_caller()?;
    photo::start_upload(caller, draft)
}

/// Idempotent, and chunks may be sent in parallel — each has its own key.
#[ic_cdk::update]
fn put_photo_chunk(args: ChunkArgs) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    photo::put_chunk(caller, args)
}

#[ic_cdk::update]
fn finish_photo_upload(r: PhotoRef) -> Res<PhotoMeta> {
    let caller = relationship::authenticated_caller()?;
    photo::finish_upload(caller, r)
}

#[ic_cdk::update]
fn abort_photo_upload(r: PhotoRef) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    photo::abort_upload(caller, r)
}

/// Metadata for the timeline, ordered by `taken_at`. Never bytes — those
/// would blow the query response limit many times over.
#[ic_cdk::query]
fn list_photos(relationship_id: u64) -> Res<Vec<PhotoMeta>> {
    let caller = relationship::authenticated_caller()?;
    photo::list(caller, relationship_id)
}

#[ic_cdk::query]
fn get_photo_meta(r: PhotoRef) -> Res<PhotoMeta> {
    let caller = relationship::authenticated_caller()?;
    photo::read_meta(caller, r)
}

/// One chunk per call. Membership is checked here, which is exactly what
/// `http_request` could not do — see the module docs in `photo`.
#[ic_cdk::query]
fn get_photo_chunk(r: ChunkRef) -> Res<Vec<u8>> {
    let caller = relationship::authenticated_caller()?;
    photo::read_chunk(caller, r)
}

#[ic_cdk::update]
fn update_photo(p: PhotoPatch) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    photo::patch(caller, p)
}

#[ic_cdk::update]
fn delete_photo(r: PhotoRef) -> Res<()> {
    let caller = relationship::authenticated_caller()?;
    photo::delete(caller, r)
}

// --- keepsakes (ICRC-7, soulbound) ---

/// Turns a milestone photo into a shared, non-transferable NFT.
///
/// Irreversible, and it makes the image publicly readable so wallets can
/// display it. Confirm with the user before calling.
#[ic_cdk::update]
fn mint_keepsake(r: PhotoRef) -> Res<u64> {
    let caller = relationship::authenticated_caller()?;
    nft::mint(caller, r)
}

#[ic_cdk::query]
fn icrc7_collection_metadata() -> Vec<(String, Value)> {
    nft::collection_metadata()
}

#[ic_cdk::query]
fn icrc7_name() -> String {
    nft::COLLECTION_NAME.to_string()
}

#[ic_cdk::query]
fn icrc7_symbol() -> String {
    nft::COLLECTION_SYMBOL.to_string()
}

#[ic_cdk::query]
fn icrc7_description() -> Option<String> {
    Some(nft::COLLECTION_DESCRIPTION.to_string())
}

#[ic_cdk::query]
fn icrc7_logo() -> Option<String> {
    // Inline so the collection has an icon without depending on any host.
    Some(
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>\
         <text y='.9em' font-size='90'>💖</text></svg>"
            .to_string(),
    )
}

#[ic_cdk::query]
fn icrc7_total_supply() -> Nat {
    Nat::from(nft::total_supply())
}

/// No cap: a couple can mark an anniversary every year for as long as it lasts.
#[ic_cdk::query]
fn icrc7_supply_cap() -> Option<Nat> {
    None
}

#[ic_cdk::query]
fn icrc7_max_query_batch_size() -> Option<Nat> {
    Some(Nat::from(nft::MAX_QUERY_BATCH_SIZE))
}

/// Zero: the only update is `mint_keepsake`, which is not a batch.
#[ic_cdk::query]
fn icrc7_max_update_batch_size() -> Option<Nat> {
    Some(Nat::from(0u64))
}

#[ic_cdk::query]
fn icrc7_default_take_value() -> Option<Nat> {
    Some(Nat::from(nft::DEFAULT_TAKE_VALUE))
}

#[ic_cdk::query]
fn icrc7_max_take_value() -> Option<Nat> {
    Some(Nat::from(nft::MAX_TAKE_VALUE))
}

#[ic_cdk::query]
fn icrc7_max_memo_size() -> Option<Nat> {
    Some(Nat::from(32u64))
}

/// Vacuously true: transfers always fail, so no batch is ever partly applied.
#[ic_cdk::query]
fn icrc7_atomic_batch_transfers() -> Option<bool> {
    Some(true)
}

#[ic_cdk::query]
fn icrc7_tx_window() -> Option<Nat> {
    None
}

#[ic_cdk::query]
fn icrc7_permitted_drift() -> Option<Nat> {
    None
}

#[ic_cdk::query]
fn icrc7_token_metadata(token_ids: Vec<Nat>) -> Vec<Option<Vec<(String, Value)>>> {
    nft::clamp_batch(token_ids)
        .iter()
        .map(|id| nft::resolve(id).and_then(nft::token_metadata))
        .collect()
}

/// One canonical owner per token, as the standard requires. Both partners are
/// in the token metadata, and `icrc7_tokens_of` answers for either.
#[ic_cdk::query]
fn icrc7_owner_of(token_ids: Vec<Nat>) -> Vec<Option<Account>> {
    nft::clamp_batch(token_ids)
        .iter()
        .map(|id| nft::resolve(id).and_then(nft::owner_of))
        .collect()
}

#[ic_cdk::query]
fn icrc7_balance_of(accounts: Vec<Account>) -> Vec<Nat> {
    nft::clamp_batch(accounts)
        .iter()
        .map(|a| Nat::from(nft::balance_of(a)))
        .collect()
}

#[ic_cdk::query]
fn icrc7_tokens(prev: Option<Nat>, take: Option<Nat>) -> Vec<Nat> {
    nft::tokens(
        prev.as_ref().and_then(nft::resolve),
        nft::clamp_take(take.as_ref().and_then(nft::resolve)),
    )
    .into_iter()
    .map(Nat::from)
    .collect()
}

#[ic_cdk::query]
fn icrc7_tokens_of(account: Account, prev: Option<Nat>, take: Option<Nat>) -> Vec<Nat> {
    nft::tokens_of(
        &account,
        prev.as_ref().and_then(nft::resolve),
        nft::clamp_take(take.as_ref().and_then(nft::resolve)),
    )
    .into_iter()
    .map(Nat::from)
    .collect()
}

/// Always fails. These are soulbound; see the module docs in `nft`.
#[ic_cdk::update]
fn icrc7_transfer(args: Vec<TransferArg>) -> Vec<Option<TransferResult>> {
    nft::refuse_transfer(&args)
}

#[ic_cdk::query]
fn icrc10_supported_standards() -> Vec<SupportedStandard> {
    nft::supported_standards()
}

// --- certified HTTP ---

/// Serves photos minted as keepsakes, and nothing else.
///
/// The boundary node calls this anonymously, so it cannot authorise anyone —
/// which is exactly why only `is_public` photos are reachable here.
#[ic_cdk::query]
fn http_request(request: HttpRequest) -> HttpResponse<'static> {
    serve::handle(&request)
}

// --- admin ---

#[ic_cdk::update]
fn admin_import_legacy(args: LegacyImportArgs) -> Res<Relationship> {
    admin::import_legacy(args)
}

#[ic_cdk::query]
fn stats() -> Stats {
    admin::stats()
}

ic_cdk::export_candid!();
