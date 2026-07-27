//! Soulbound keepsakes: an opt-in ICRC-7 collection over milestone photos.
//!
//! # Soulbound on purpose
//!
//! `icrc7_transfer` always fails. A photo of two people that one of them can
//! sell would make ownership and membership two separate, conflicting sources
//! of truth — and a stranger holding the token would then have a claim on a
//! private couple's photo. Refusing transfer keeps the two aligned by
//! construction, and no ICRC-37 approval surface exists to work around it.
//!
//! # Opt-in, and irreversible
//!
//! Minting flips `is_public` so the image is servable at a URL a wallet can
//! load (see `serve`). That cannot be undone: an NFT whose image can vanish is
//! not worth minting. The UI confirms this in as many words.
//!
//! # Deliberate deviation from the spec
//!
//! ICRC-7 allows one owner per token. These belong to two people, so
//! `icrc7_owner_of` reports the proposer as canonical while `icrc7_tokens_of`
//! and `icrc7_balance_of` answer for either partner. The sum of all balances
//! is therefore twice `icrc7_total_supply`. This is stated in
//! `icrc7_description` so an indexer's author can see it.
//!
//! ICRC-3 (the transaction log) is not implemented. A soulbound token has
//! exactly one event in its life — the mint — and no history to walk. Some
//! wallets will decline to index the collection as a result.

use crate::constants::MAX_TITLE_CHARS;
use crate::errors::{Err, Res};
use crate::memory::*;
use crate::photo;
use crate::relationship;
use crate::serve;
use crate::storable::{OwnerTokenKey, PKey, PhotoKey};
use crate::types::*;
use candid::{Nat, Principal};
use ic_cdk::api::{canister_self, time};

pub const COLLECTION_NAME: &str = "Keepsakes";
pub const COLLECTION_SYMBOL: &str = "KEEP";
pub const COLLECTION_DESCRIPTION: &str = concat!(
    "Soulbound milestone photos from relationships recorded on-chain. ",
    "Transfers always fail. Each token belongs to both partners: owner_of ",
    "reports the proposer, while tokens_of and balance_of answer for either, ",
    "so total balances are twice total_supply."
);

/// ICRC-7 batch-query ceilings, advertised so callers can page correctly.
pub const MAX_QUERY_BATCH_SIZE: u64 = 100;
pub const DEFAULT_TAKE_VALUE: u64 = 100;
pub const MAX_TAKE_VALUE: u64 = 1000;

fn nat(n: u64) -> Nat {
    Nat::from(n)
}

/// `token_id` is a `nat` on the wire but a `u64` internally; anything larger
/// than we ever minted is simply not a token.
fn as_u64(token_id: &Nat) -> Option<u64> {
    token_id.0.to_u64_digits().first().copied().or(Some(0)).filter(|_| {
        token_id.0.to_u64_digits().len() <= 1
    })
}

fn photo_of(token_id: u64) -> Option<PhotoMeta> {
    let key = with_tokens(|m| m.get(&token_id))?;
    with_photos(|m| m.get(&key))
}

/// Mints a keepsake for a milestone photo, shared by both partners.
///
/// Irreversible: the photo becomes publicly servable so a wallet can load it.
pub fn mint(caller: Principal, r: PhotoRef) -> Res<u64> {
    let rel = relationship::get(r.relationship_id)?;
    if !rel.is_member(caller) {
        return Err(Err::NotAMember);
    }
    if rel.status != RelStatus::Active {
        return Err(Err::InvalidState(
            "keepsakes can only be minted while the relationship is active".into(),
        ));
    }
    let recipient = rel.recipient.ok_or_else(|| {
        Err::InvalidState("this relationship has no second partner yet".into())
    })?;

    let mut meta = photo::get_meta(r.relationship_id, r.photo_id)?;
    if meta.state != PhotoState::Complete {
        return Err(Err::InvalidState("this photo is still uploading".into()));
    }
    if meta.token_id.is_some() {
        return Err(Err::InvalidState("this photo is already a keepsake".into()));
    }
    // Milestones only. Minting every snapshot would make the collection
    // meaningless and publish far more than anyone intended.
    if meta.kind == PhotoKind::Memory {
        return Err(Err::InvalidState(
            "only the first photo and anniversary photos can become keepsakes".into(),
        ));
    }

    let token_id = next_token_id();
    meta.token_id = Some(token_id);
    meta.is_public = true;
    with_photos_mut(|m| {
        m.insert(
            PhotoKey {
                rel: r.relationship_id,
                photo: r.photo_id,
            },
            meta.clone(),
        )
    });

    with_tokens_mut(|m| {
        m.insert(
            token_id,
            PhotoKey {
                rel: r.relationship_id,
                photo: r.photo_id,
            },
        )
    });
    with_partners_mut(|m| {
        m.insert(
            token_id,
            TokenPartners {
                proposer: rel.proposer,
                recipient,
                minted_at: time(),
            },
        )
    });
    with_owner_tokens_mut(|m| {
        m.insert(
            OwnerTokenKey {
                owner: PKey::from(rel.proposer),
                token: token_id,
            },
            0,
        );
        m.insert(
            OwnerTokenKey {
                owner: PKey::from(recipient),
                token: token_id,
            },
            0,
        );
    });
    update_config(|c| c.total_tokens += 1);

    // Must happen in this same call: a query for a public photo that isn't in
    // the tree yet would fail response verification at the boundary node.
    serve::certify(&meta);
    Ok(token_id)
}

// --- ICRC-7 reads ---

pub fn collection_metadata() -> Vec<(String, Value)> {
    vec![
        ("icrc7:name".into(), Value::Text(COLLECTION_NAME.into())),
        ("icrc7:symbol".into(), Value::Text(COLLECTION_SYMBOL.into())),
        (
            "icrc7:description".into(),
            Value::Text(COLLECTION_DESCRIPTION.into()),
        ),
        ("icrc7:total_supply".into(), Value::Nat(nat(total_supply()))),
        (
            "icrc7:max_query_batch_size".into(),
            Value::Nat(nat(MAX_QUERY_BATCH_SIZE)),
        ),
        ("icrc7:supply_cap".into(), Value::Nat(nat(0))),
    ]
}

pub fn total_supply() -> u64 {
    with_tokens(|m| m.len())
}

/// The canister's own origin, so `icrc7:image` resolves for a wallet.
fn image_url(rel: u64, photo: u64) -> String {
    format!(
        "https://{}.icp0.io{}",
        canister_self().to_text(),
        serve::photo_path(rel, photo)
    )
}

pub fn token_metadata(token_id: u64) -> Option<Vec<(String, Value)>> {
    let meta = photo_of(token_id)?;
    let partners = with_partners(|m| m.get(&token_id))?;
    let rel = relationship::get(meta.relationship_id).ok();

    let title = rel
        .as_ref()
        .map(|r| r.title.clone())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| COLLECTION_NAME.to_string());
    let name = match meta.kind {
        PhotoKind::First => format!("{title} — the day it started"),
        _ => format!("{title} — an anniversary"),
    };

    Some(vec![
        (
            "icrc7:name".into(),
            Value::Text(name.chars().take(MAX_TITLE_CHARS * 2).collect()),
        ),
        ("icrc7:description".into(), Value::Text(meta.caption.clone())),
        (
            "icrc7:image".into(),
            Value::Text(image_url(meta.relationship_id, meta.photo_id)),
        ),
        ("content_type".into(), Value::Text(meta.content_type.clone())),
        ("width".into(), Value::Nat(nat(meta.width as u64))),
        ("height".into(), Value::Nat(nat(meta.height as u64))),
        ("sha256".into(), Value::Blob(meta.sha256.clone())),
        ("taken_at".into(), Value::Nat(nat(meta.taken_at))),
        ("minted_at".into(), Value::Nat(nat(partners.minted_at))),
        (
            "relationship_id".into(),
            Value::Nat(nat(meta.relationship_id)),
        ),
        (
            "partners".into(),
            Value::Array(vec![
                Value::Text(partners.proposer.to_text()),
                Value::Text(partners.recipient.to_text()),
            ]),
        ),
        ("soulbound".into(), Value::Text("true".into())),
    ])
}

/// The canonical single owner ICRC-7 asks for. See the module docs.
pub fn owner_of(token_id: u64) -> Option<Account> {
    with_partners(|m| m.get(&token_id)).map(|p| Account {
        owner: p.proposer,
        subaccount: None,
    })
}

pub fn balance_of(account: &Account) -> u64 {
    let owner = PKey::from(account.owner);
    with_owner_tokens(|m| {
        m.range(OwnerTokenKey::lo(owner)..=OwnerTokenKey::hi(owner))
            .count() as u64
    })
}

/// Ids ascend, so `prev` paging is a simple "strictly greater than" scan.
pub fn tokens(prev: Option<u64>, take: u64) -> Vec<u64> {
    let start = prev.map_or(0, |p| p.saturating_add(1));
    with_tokens(|m| {
        m.range(start..)
            .map(|e| *e.key())
            .take(take as usize)
            .collect()
    })
}

pub fn tokens_of(account: &Account, prev: Option<u64>, take: u64) -> Vec<u64> {
    let owner = PKey::from(account.owner);
    let start = OwnerTokenKey {
        owner,
        token: prev.map_or(0, |p| p.saturating_add(1)),
    };
    with_owner_tokens(|m| {
        m.range(start..=OwnerTokenKey::hi(owner))
            .map(|e| e.key().token)
            .take(take as usize)
            .collect()
    })
}

pub fn clamp_take(take: Option<u64>) -> u64 {
    take.unwrap_or(DEFAULT_TAKE_VALUE).min(MAX_TAKE_VALUE)
}

/// Batch queries truncate rather than trap, so an oversized request degrades
/// into a short page instead of an error.
pub fn clamp_batch<T>(items: Vec<T>) -> Vec<T> {
    items.into_iter().take(MAX_QUERY_BATCH_SIZE as usize).collect()
}

pub fn resolve(token_id: &Nat) -> Option<u64> {
    as_u64(token_id)
}

pub fn supported_standards() -> Vec<SupportedStandard> {
    vec![
        SupportedStandard {
            name: "ICRC-7".into(),
            url: "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md".into(),
        },
        SupportedStandard {
            name: "ICRC-10".into(),
            url: "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-10/ICRC-10.md".into(),
        },
    ]
}

/// Always refuses. Soulbound is the point — see the module docs.
pub fn refuse_transfer(args: &[TransferArg]) -> Vec<Option<TransferResult>> {
    args.iter()
        .map(|arg| {
            Some(Err(if with_tokens(|m| {
                as_u64(&arg.token_id).is_some_and(|id| m.contains_key(&id))
            }) {
                TransferError::GenericError {
                    error_code: nat(100),
                    message: "keepsakes are soulbound and cannot be transferred".into(),
                }
            } else {
                TransferError::NonExistingTokenId
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nat_token_ids_beyond_u64_are_not_tokens() {
        assert_eq!(as_u64(&nat(0)), Some(0));
        assert_eq!(as_u64(&nat(u64::MAX)), Some(u64::MAX));
        // A caller can pass an arbitrarily large nat; it must miss, not wrap.
        let huge = Nat::from(u128::from(u64::MAX) + 1);
        assert_eq!(as_u64(&huge), None);
    }

    #[test]
    fn take_is_clamped_to_the_advertised_maximum() {
        assert_eq!(clamp_take(None), DEFAULT_TAKE_VALUE);
        assert_eq!(clamp_take(Some(5)), 5);
        assert_eq!(clamp_take(Some(u64::MAX)), MAX_TAKE_VALUE);
    }

    #[test]
    fn batches_truncate_rather_than_fail() {
        let over: Vec<u64> = (0..MAX_QUERY_BATCH_SIZE + 50).collect();
        assert_eq!(clamp_batch(over).len(), MAX_QUERY_BATCH_SIZE as usize);
    }
}
