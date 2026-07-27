//! Controller-only endpoints.

use crate::errors::{Err, Res};
use crate::memory::*;
use crate::relationship;
use crate::storable::PKey;
use crate::types::*;
use candid::Nat;
use ic_cdk::api::{canister_cycle_balance, is_controller, msg_caller, stable_size};

fn require_controller() -> Res<()> {
    if !is_controller(&msg_caller()) {
        return Err(Err::Forbidden("controller only".into()));
    }
    Ok(())
}

/// Re-seeds the single relationship that lived in the pre-stable-memory
/// canister.
///
/// That state was in the Wasm heap with no `pre_upgrade`, so it does not
/// survive the upgrade that introduces this module and no code running here
/// can recover it — the values have to be read off the live canister first and
/// passed back in. Runs once; afterwards `legacy_imported` blocks it.
pub fn import_legacy(args: LegacyImportArgs) -> Res<Relationship> {
    require_controller()?;
    if config().legacy_imported {
        return Err(Err::Forbidden("legacy state was already imported".into()));
    }
    if args.proposer == args.recipient {
        return Err(Err::SelfProposal);
    }
    if relationship::active_id_of(args.proposer).is_some()
        || relationship::active_id_of(args.recipient).is_some()
    {
        return Err(Err::Forbidden(
            "one of these principals is already in an active relationship".into(),
        ));
    }

    let id = next_relationship_id();
    let rel = Relationship {
        id,
        proposer: args.proposer,
        recipient: Some(args.recipient),
        pinned: true,
        invite_code: None,
        expires_at: None,
        status: RelStatus::Active,
        message: args.message,
        title: args.title,
        // The original canister only ever recorded the acceptance time.
        created_at: args.accepted_at,
        responded_at: Some(args.accepted_at),
        accepted_at: Some(args.accepted_at),
        ended_at: None,
        ended_by: None,
        end_reason: String::new(),
        first_photo_id: None,
        next_photo_id: 1,
        photo_count: 0,
        bytes_used: 0,
    };
    relationship::put(&rel);
    with_active_mut(|m| {
        m.insert(PKey::from(args.proposer), id);
        m.insert(PKey::from(args.recipient), id);
    });
    update_config(|c| c.legacy_imported = true);
    Ok(rel)
}

pub fn stats() -> Stats {
    let cfg = config();
    Stats {
        relationships: with_relationships(|m| m.len()),
        active_relationships: with_active(|m| m.len()),
        pending_invites: with_codes(|m| m.len()),
        photos: cfg.total_photos,
        bytes_used: cfg.total_bytes,
        // Bill against this, not `bytes_used`: stable memory grows and is
        // never returned to the subnet, so deleting data does not shrink it.
        stable_pages: stable_size(),
        cycles_balance: Nat::from(canister_cycle_balance()),
        schema_version: cfg.schema_version,
    }
}
