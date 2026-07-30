//! The handshake state machine.
//!
//! Five index maps have to stay consistent with `Relationship.status`. Every
//! transition goes through one of the `close_pending` / `activate` helpers
//! below rather than touching the indexes directly, because an index that
//! disagrees with the record shows up much later as a principal who can never
//! propose again.

use crate::constants::*;
use crate::errors::{check_len, Err, Res};
use crate::invite;
use crate::memory::*;
use crate::storable::{InboxKey, MemberRelKey, PKey};
use crate::types::*;
use candid::Principal;
use ic_cdk::api::{msg_caller, time};

/// Rejects the anonymous principal. Returned as an error rather than a trap so
/// the frontend renders a sign-in prompt instead of a call rejection.
pub fn authenticated_caller() -> Res<Principal> {
    let caller = msg_caller();
    if caller == Principal::anonymous() {
        return Err(Err::NotAuthenticated);
    }
    Ok(caller)
}

pub fn get(id: u64) -> Res<Relationship> {
    with_relationships(|m| m.get(&id)).ok_or(Err::NotFound)
}

pub fn put(rel: &Relationship) {
    with_relationships_mut(|m| m.insert(rel.id, rel.clone()));
    with_member_relationships_mut(|m| {
        m.insert(
            MemberRelKey {
                member: PKey::from(rel.proposer),
                rel: rel.id,
            },
            0,
        );
        if let Some(recipient) = rel.recipient {
            m.insert(
                MemberRelKey {
                    member: PKey::from(recipient),
                    rel: rel.id,
                },
                0,
            );
        }
    });
}

pub fn active_id_of(who: Principal) -> Option<u64> {
    with_active(|m| m.get(&PKey::from(who)))
}

pub fn outgoing_id_of(who: Principal) -> Option<u64> {
    with_outgoing(|m| m.get(&PKey::from(who)))
}

/// Drops every `Pending`-only index entry and stamps the terminal status.
///
/// Used by decline, cancel and expiry alike — they differ only in the status
/// and in who is recorded as responding.
fn close_pending(rel: &mut Relationship, status: RelStatus, now: u64, responded: bool) {
    with_outgoing_mut(|m| m.remove(&PKey::from(rel.proposer)));
    if let Some(recipient) = rel.recipient {
        if rel.pinned {
            with_inbox_mut(|m| {
                m.remove(&InboxKey {
                    who: PKey::from(recipient),
                    rel: rel.id,
                })
            });
        }
    }
    invite::release_for(&rel.invite_code);
    rel.invite_code = None;
    rel.status = status;
    if responded {
        rel.responded_at = Some(now);
    }
    put(rel);
}

/// Lazily retires an invite whose TTL has passed.
///
/// Returns true if the relationship was expired and is now `Cancelled`. This
/// is why there is no timer: nothing observes a stale invite without first
/// passing through here.
fn expire_if_due(rel: &mut Relationship, now: u64) -> bool {
    if !rel.is_expired(now) {
        return false;
    }
    close_pending(rel, RelStatus::Cancelled, now, false);
    true
}

/// Clears the caller's own outgoing invite if it has expired, so an abandoned
/// link never permanently blocks them from proposing again.
fn sweep_own_outgoing(who: Principal, now: u64) {
    let Some(id) = outgoing_id_of(who) else {
        return;
    };
    let Ok(mut rel) = get(id) else {
        // Index pointing at a missing record: drop the dangling entry rather
        // than leaving the principal wedged.
        with_outgoing_mut(|m| m.remove(&PKey::from(who)));
        return;
    };
    expire_if_due(&mut rel, now);
}

/// Both parties must be unattached. Checked immediately before the write, and
/// in `propose`'s case *after* the `raw_rand` await, since an interleaved
/// message could have paired either of them up in the meantime.
fn assert_both_free(a: Principal, b: Option<Principal>) -> Res<()> {
    if active_id_of(a).is_some() {
        return Err(Err::AlreadyInRelationship(a));
    }
    if let Some(b) = b {
        if active_id_of(b).is_some() {
            return Err(Err::AlreadyInRelationship(b));
        }
    }
    Ok(())
}

fn validate_propose_args(caller: Principal, args: &ProposeArgs) -> Res<u64> {
    check_len("message", &args.message, MAX_MESSAGE_CHARS)?;
    check_len("title", &args.title, MAX_TITLE_CHARS)?;

    if args.pinned && args.recipient.is_none() {
        return Err(Err::Invalid(
            "pinned invites need a recipient principal".into(),
        ));
    }
    if args.recipient == Some(caller) {
        return Err(Err::SelfProposal);
    }
    if args.recipient == Some(Principal::anonymous()) {
        return Err(Err::Invalid(
            "the anonymous principal cannot be a recipient".into(),
        ));
    }

    let ttl = args.ttl_seconds.unwrap_or(DEFAULT_TTL_SECONDS);
    if !(MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl) {
        return Err(Err::Invalid(format!(
            "ttl_seconds must be between {MIN_TTL_SECONDS} and {MAX_TTL_SECONDS}"
        )));
    }
    Ok(ttl)
}

/// Everything `propose` checks against live state. Called once before the
/// `raw_rand` await to fail fast, and again after it, where it is the one that
/// actually counts.
fn check_propose_preconditions(caller: Principal, args: &ProposeArgs, now: u64) -> Res<()> {
    sweep_own_outgoing(caller, now);
    if let Some(id) = outgoing_id_of(caller) {
        return Err(Err::DuplicateInvite(id));
    }
    assert_both_free(caller, args.recipient)
}

use std::cell::RefCell;
use std::collections::BTreeSet;

thread_local! {
    static PENDING_PROPOSALS: RefCell<BTreeSet<Principal>> = RefCell::new(BTreeSet::new());
}

pub struct ProposalGuard(pub Principal);

impl Drop for ProposalGuard {
    fn drop(&mut self) {
        PENDING_PROPOSALS.with_borrow_mut(|set| {
            set.remove(&self.0);
        });
    }
}

pub fn precheck_propose(caller: Principal, args: &ProposeArgs) -> Res<ProposalGuard> {
    PENDING_PROPOSALS.with_borrow_mut(|set| {
        if !set.insert(caller) {
            return Err(Err::InvalidState(
                "a proposal creation is already in progress for this user".into(),
            ));
        }
        Ok(())
    })?;

    let res = (|| {
        let _ttl = validate_propose_args(caller, args)?;
        check_propose_preconditions(caller, args, time())?;
        Ok(())
    })();

    if res.is_err() {
        PENDING_PROPOSALS.with_borrow_mut(|set| {
            set.remove(&caller);
        });
        res?;
    }

    Ok(ProposalGuard(caller))
}

/// Second half of `propose`, run after `raw_rand` returns.
///
/// Re-validates from scratch: between the two halves the canister may have
/// processed any number of other messages, so nothing read before the await
/// can be trusted.
pub fn finish_propose(
    guard: ProposalGuard,
    caller: Principal,
    args: ProposeArgs,
    entropy: &[u8],
) -> Res<Relationship> {
    let _g = guard;
    let now = time();
    let ttl = validate_propose_args(caller, &args)?;
    check_propose_preconditions(caller, &args, now)?;

    let code = invite::mint_from_entropy(entropy)?;
    let id = next_relationship_id();

    let rel = Relationship {
        id,
        proposer: caller,
        recipient: args.recipient,
        pinned: args.pinned,
        invite_code: Some(invite::to_display(&code)),
        expires_at: Some(now + ttl * NS_PER_SEC),
        status: RelStatus::Pending,
        message: args.message,
        title: args.title,
        created_at: now,
        responded_at: None,
        accepted_at: None,
        ended_at: None,
        ended_by: None,
        end_reason: String::new(),
        first_photo_id: None,
        next_photo_id: 1,
        photo_count: 0,
        bytes_used: 0,
    };

    put(&rel);
    invite::bind(code, id);
    with_outgoing_mut(|m| m.insert(PKey::from(caller), id));
    // Only pinned invites land in an inbox. An open link is reachable solely
    // through the link, which is what makes it shareable before you know who
    // is on the other end.
    if rel.pinned {
        if let Some(recipient) = rel.recipient {
            with_inbox_mut(|m| {
                m.insert(
                    InboxKey {
                        who: PKey::from(recipient),
                        rel: id,
                    },
                    0,
                )
            });
        }
    }
    Ok(rel)
}

/// Shared tail of `accept_invite` and an accepting `respond_to_proposal`.
fn activate(mut rel: Relationship, caller: Principal, now: u64) -> Res<Relationship> {
    if rel.status != RelStatus::Pending {
        return Err(Err::InvalidState(format!(
            "this proposal is {:?}, not pending",
            rel.status
        )));
    }
    if caller == rel.proposer {
        return Err(Err::SelfProposal);
    }
    if rel.pinned && rel.recipient != Some(caller) {
        // Same error an unknown code gets: do not confirm to a stranger that
        // they found a real invite addressed to someone else.
        return Err(Err::NotFound);
    }
    // Re-checked here and not only at propose time: two people can be holding
    // the same link, and either of them may have paired up since it was sent.
    assert_both_free(caller, Some(rel.proposer))?;

    with_outgoing_mut(|m| {
        m.remove(&PKey::from(rel.proposer));
        m.remove(&PKey::from(caller));
    });
    if rel.pinned {
        with_inbox_mut(|m| {
            m.remove(&InboxKey {
                who: PKey::from(caller),
                rel: rel.id,
            })
        });
    }
    invite::release_for(&rel.invite_code);

    rel.recipient = Some(caller);
    rel.invite_code = None;
    rel.expires_at = None;
    rel.status = RelStatus::Active;
    rel.responded_at = Some(now);
    rel.accepted_at = Some(now);
    put(&rel);

    with_active_mut(|m| {
        m.insert(PKey::from(rel.proposer), rel.id);
        m.insert(PKey::from(caller), rel.id);
    });
    Ok(rel)
}

pub fn accept_by_code(caller: Principal, raw_code: &str) -> Res<Relationship> {
    let now = time();
    let key = invite::normalize(raw_code)?;
    let id = invite::lookup(&key).ok_or(Err::NotFound)?;
    let mut rel = get(id)?;
    if expire_if_due(&mut rel, now) {
        return Err(Err::NotFound);
    }
    activate(rel, caller, now)
}

pub fn decline_by_code(caller: Principal, raw_code: &str) -> Res<()> {
    let now = time();
    let key = invite::normalize(raw_code)?;
    let id = invite::lookup(&key).ok_or(Err::NotFound)?;
    let mut rel = get(id)?;
    if expire_if_due(&mut rel, now) {
        return Err(Err::NotFound);
    }
    if caller == rel.proposer {
        return Err(Err::Invalid("use cancel_proposal to withdraw your own invite".into()));
    }
    if rel.pinned && rel.recipient != Some(caller) {
        return Err(Err::NotFound);
    }
    // An open link declined by one holder is spent for everyone. That is the
    // intended reading of "no": the proposer has to send a fresh one.
    if !rel.pinned {
        rel.recipient = Some(caller);
    }
    close_pending(&mut rel, RelStatus::Declined, now, true);
    Ok(())
}

pub fn respond(caller: Principal, args: RespondArgs) -> Res<Relationship> {
    let now = time();
    let mut rel = get(args.relationship_id)?;
    if expire_if_due(&mut rel, now) {
        return Err(Err::InvalidState("this invite has expired".into()));
    }
    // Reachable by id only for pinned invites; an open link must go through
    // the code, which is the only thing proving the caller was invited.
    if !rel.pinned || rel.recipient != Some(caller) {
        return Err(Err::NotFound);
    }
    if args.accept {
        activate(rel, caller, now)
    } else {
        close_pending(&mut rel, RelStatus::Declined, now, true);
        Ok(rel)
    }
}

pub fn cancel(caller: Principal, id: u64) -> Res<()> {
    let now = time();
    let mut rel = get(id)?;
    if rel.proposer != caller {
        return Err(Err::NotAMember);
    }
    if expire_if_due(&mut rel, now) {
        return Ok(());
    }
    if rel.status != RelStatus::Pending {
        return Err(Err::InvalidState(format!(
            "this proposal is {:?} and cannot be cancelled",
            rel.status
        )));
    }
    close_pending(&mut rel, RelStatus::Cancelled, now, false);
    Ok(())
}

pub fn end(caller: Principal, args: EndArgs) -> Res<()> {
    check_len("reason", &args.reason, MAX_END_REASON_CHARS)?;
    let mut rel = get(args.relationship_id)?;
    if !rel.is_member(caller) {
        return Err(Err::NotAMember);
    }
    if rel.status != RelStatus::Active {
        return Err(Err::InvalidState(format!(
            "this relationship is {:?}, not active",
            rel.status
        )));
    }
    // Unilateral by design. Requiring mutual consent to end something would
    // trap whoever wants out behind the other person's inaction.
    with_active_mut(|m| {
        m.remove(&PKey::from(rel.proposer));
        if let Some(recipient) = rel.recipient {
            m.remove(&PKey::from(recipient));
        }
    });
    // Clean up any un-finalized upload session and chunks for this relationship.
    crate::photo::abort_all_pending_uploads(rel.id);
    rel.status = RelStatus::Ended;
    rel.ended_at = Some(time());
    rel.ended_by = Some(caller);
    rel.end_reason = args.reason;
    // accepted_at is deliberately left alone — it still happened.
    put(&rel);
    Ok(())
}

pub fn set_title(caller: Principal, args: SetTitleArgs) -> Res<()> {
    check_len("title", &args.title, MAX_TITLE_CHARS)?;
    let mut rel = get(args.relationship_id)?;
    if !rel.is_member(caller) {
        return Err(Err::NotAMember);
    }
    rel.title = args.title;
    put(&rel);
    Ok(())
}

pub fn preview(raw_code: &str) -> Res<InvitePreview> {
    let key = invite::normalize(raw_code)?;
    let id = invite::lookup(&key).ok_or(Err::NotFound)?;
    let rel = get(id)?;
    // A query cannot write, so expiry is reported without being recorded; the
    // next update call through this code will retire it for real.
    if rel.status != RelStatus::Pending || rel.is_expired(time()) {
        return Err(Err::NotFound);
    }
    Ok(InvitePreview {
        relationship_id: rel.id,
        proposer: rel.proposer,
        message: rel.message,
        title: rel.title,
        created_at: rel.created_at,
        expires_at: rel.expires_at,
        pinned: rel.pinned,
    })
}

/// Reads a relationship the caller belongs to.
pub fn get_for_member(caller: Principal, id: u64) -> Res<Relationship> {
    let rel = get(id)?;
    if !rel.is_member(caller) {
        return Err(Err::NotAMember);
    }
    Ok(rel)
}

pub fn my_state() -> MyState {
    let caller = msg_caller();
    let now = time();

    // Anonymous callers get an empty state rather than an error: this backs
    // the initial page load, before the sign-in prompt has been answered.
    if caller == Principal::anonymous() {
        return MyState {
            caller,
            now,
            active: None,
            outgoing: None,
            incoming: Vec::new(),
            history: Vec::new(),
        };
    }

    let active = active_id_of(caller).and_then(|id| get(id).ok());

    // Queries cannot write, so an expired invite is filtered out here and
    // retired on the next update that touches it.
    let outgoing = outgoing_id_of(caller)
        .and_then(|id| get(id).ok())
        .filter(|r| !r.is_expired(now));

    let who = PKey::from(caller);
    let incoming: Vec<Relationship> = with_inbox(|m| {
        m.range(InboxKey::lo(who)..=InboxKey::hi(who))
            // key() only, so the placeholder values are never deserialized.
            .map(|e| e.key().rel)
            .collect::<Vec<_>>()
    })
    .into_iter()
    .filter_map(|id| get(id).ok())
    .filter(|r| r.status == RelStatus::Pending && !r.is_expired(now))
    .collect();

    // Uses MemoryId(12) index keyed by member for O(log N + K) range scan.
    // MemberRelKey puts rel ID at the tail in big-endian, so .rev() iterates newest-first.
    let rel_ids: Vec<u64> = with_member_relationships(|m| {
        m.range(MemberRelKey::lo(who)..=MemberRelKey::hi(who))
            .map(|e| e.key().rel)
            .rev()
            .collect()
    });

    let mut history = Vec::with_capacity(MAX_HISTORY_ITEMS);
    for id in rel_ids {
        if let Ok(r) = get(id) {
            if r.is_member(caller)
                && matches!(
                    r.status,
                    RelStatus::Ended | RelStatus::Declined | RelStatus::Cancelled
                )
            {
                history.push(r);
                if history.len() >= MAX_HISTORY_ITEMS {
                    break;
                }
            }
        }
    }

    MyState {
        caller,
        now,
        active,
        outgoing,
        incoming,
        history,
    }
}

/// Answers the pre-overhaul frontend's only question, so the deployed asset
/// build survives the window between the backend and frontend deploys.
pub fn legacy_status() -> ProposalStatus {
    let caller = msg_caller();
    match active_id_of(caller).and_then(|id| get(id).ok()) {
        Some(rel) => ProposalStatus {
            is_accepted: true,
            accepted_time: rel.accepted_at.unwrap_or(0),
            accepted_by: rel.partner_of(caller),
        },
        None => ProposalStatus {
            is_accepted: false,
            accepted_time: 0,
            accepted_by: None,
        },
    }
}
