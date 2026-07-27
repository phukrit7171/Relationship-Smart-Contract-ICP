//! Key encodings and `Storable` impls.
//!
//! Two rules hold for every key type here, and breaking either one fails
//! silently rather than loudly:
//!
//! 1. Integers are **big-endian**. `StableBTreeMap` orders by raw bytes, so
//!    little-endian would make `range()` return an arbitrary subset.
//! 2. Composite keys are **fixed width**. A variable-width prefix lets one
//!    key's tail bleed into the next field's sort position.

use crate::types::{Config, ConfigV1, PhotoMeta, Relationship, TokenPartners};
use candid::Principal;
use ic_stable_structures::storable::{Bound, Storable};
use std::borrow::Cow;

/// A principal padded to a fixed 30 bytes: `[len, bytes.., 0..]`.
///
/// The stock `Storable for Principal` is variable-width (`is_fixed_size:
/// false`), which is fine as a whole key but unusable as the prefix of a
/// composite one. Length-prefixing keeps distinct principals distinct even
/// when one is a byte-prefix of another.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct PKey([u8; PKey::LEN]);

impl PKey {
    pub const LEN: usize = 30;

    /// Inverse of `From<Principal>`. Only the tests need it today; the index
    /// maps are all lookups by known principal rather than scans.
    #[allow(dead_code)]
    pub fn to_principal(&self) -> Principal {
        let len = self.0[0] as usize;
        Principal::from_slice(&self.0[1..1 + len])
    }
}

impl From<Principal> for PKey {
    fn from(p: Principal) -> Self {
        let s = p.as_slice();
        // Principal::MAX_LENGTH_IN_BYTES is 29, so this always fits.
        let mut b = [0u8; PKey::LEN];
        b[0] = s.len() as u8;
        b[1..1 + s.len()].copy_from_slice(s);
        PKey(b)
    }
}

impl Storable for PKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Borrowed(&self.0)
    }
    fn into_bytes(self) -> Vec<u8> {
        self.0.to_vec()
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut b = [0u8; PKey::LEN];
        b.copy_from_slice(&bytes);
        PKey(b)
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: PKey::LEN as u32,
        is_fixed_size: true,
    };
}

/// `(recipient, relationship_id)` — lets one principal's pending invites be
/// listed with a single prefix range scan.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct InboxKey {
    pub who: PKey,
    pub rel: u64,
}

impl InboxKey {
    pub const LEN: usize = PKey::LEN + 8;

    /// Inclusive lower bound of `who`'s inbox, for `range()`.
    pub fn lo(who: PKey) -> Self {
        Self { who, rel: 0 }
    }
    /// Inclusive upper bound of `who`'s inbox, for `range()`.
    pub fn hi(who: PKey) -> Self {
        Self {
            who,
            rel: u64::MAX,
        }
    }
}

impl Storable for InboxKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(self.into_bytes())
    }
    fn into_bytes(self) -> Vec<u8> {
        let mut v = Vec::with_capacity(Self::LEN);
        v.extend_from_slice(&self.who.0);
        v.extend_from_slice(&self.rel.to_be_bytes());
        v
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut who = [0u8; PKey::LEN];
        who.copy_from_slice(&bytes[..PKey::LEN]);
        let mut rel = [0u8; 8];
        rel.copy_from_slice(&bytes[PKey::LEN..]);
        Self {
            who: PKey(who),
            rel: u64::from_be_bytes(rel),
        }
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: Self::LEN as u32,
        is_fixed_size: true,
    };
}

/// `(relationship_id, photo_id)` — one relationship's photos scan as a range.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct PhotoKey {
    pub rel: u64,
    pub photo: u64,
}

impl PhotoKey {
    pub fn lo(rel: u64) -> Self {
        Self { rel, photo: 0 }
    }
    pub fn hi(rel: u64) -> Self {
        Self {
            rel,
            photo: u64::MAX,
        }
    }
}

impl Storable for PhotoKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(self.into_bytes())
    }
    fn into_bytes(self) -> Vec<u8> {
        let mut v = Vec::with_capacity(16);
        v.extend_from_slice(&self.rel.to_be_bytes());
        v.extend_from_slice(&self.photo.to_be_bytes());
        v
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Self {
            rel: u64::from_be_bytes(bytes[..8].try_into().unwrap()),
            photo: u64::from_be_bytes(bytes[8..16].try_into().unwrap()),
        }
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: 16,
        is_fixed_size: true,
    };
}

/// `(relationship_id, photo_id, chunk_index)` — one photo's chunks scan and
/// delete as a range, and each chunk is written independently so a client can
/// upload them in parallel.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct ChunkKey {
    pub rel: u64,
    pub photo: u64,
    pub idx: u32,
}

impl ChunkKey {
    pub fn lo(rel: u64, photo: u64) -> Self {
        Self { rel, photo, idx: 0 }
    }
    pub fn hi(rel: u64, photo: u64) -> Self {
        Self {
            rel,
            photo,
            idx: u32::MAX,
        }
    }
}

impl Storable for ChunkKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(self.into_bytes())
    }
    fn into_bytes(self) -> Vec<u8> {
        let mut v = Vec::with_capacity(20);
        v.extend_from_slice(&self.rel.to_be_bytes());
        v.extend_from_slice(&self.photo.to_be_bytes());
        v.extend_from_slice(&self.idx.to_be_bytes());
        v
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Self {
            rel: u64::from_be_bytes(bytes[..8].try_into().unwrap()),
            photo: u64::from_be_bytes(bytes[8..16].try_into().unwrap()),
            idx: u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
        }
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: 20,
        is_fixed_size: true,
    };
}

/// A normalised invite code. Fixed width, so it is directly comparable.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct CodeKey(pub [u8; crate::constants::CODE_LEN]);

impl Storable for CodeKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Borrowed(&self.0)
    }
    fn into_bytes(self) -> Vec<u8> {
        self.0.to_vec()
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut b = [0u8; crate::constants::CODE_LEN];
        b.copy_from_slice(&bytes);
        CodeKey(b)
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: crate::constants::CODE_LEN as u32,
        is_fixed_size: true,
    };
}

/// `(owner, token_id)` — one principal's keepsakes scan as a range.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct OwnerTokenKey {
    pub owner: PKey,
    pub token: u64,
}

impl OwnerTokenKey {
    pub const LEN: usize = PKey::LEN + 8;

    pub fn lo(owner: PKey) -> Self {
        Self { owner, token: 0 }
    }
    pub fn hi(owner: PKey) -> Self {
        Self {
            owner,
            token: u64::MAX,
        }
    }
}

impl Storable for OwnerTokenKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(self.into_bytes())
    }
    fn into_bytes(self) -> Vec<u8> {
        let mut v = Vec::with_capacity(Self::LEN);
        v.extend_from_slice(&self.owner.0);
        v.extend_from_slice(&self.token.to_be_bytes());
        v
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut owner = [0u8; PKey::LEN];
        owner.copy_from_slice(&bytes[..PKey::LEN]);
        Self {
            owner: PKey(owner),
            token: u64::from_be_bytes(bytes[PKey::LEN..].try_into().unwrap()),
        }
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: Self::LEN as u32,
        is_fixed_size: true,
    };
}

/// `(member, relationship_id)` — indexed per-member relationship history range scan.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct MemberRelKey {
    pub member: PKey,
    pub rel: u64,
}

impl MemberRelKey {
    pub const LEN: usize = PKey::LEN + 8;

    pub fn lo(member: PKey) -> Self {
        Self { member, rel: 0 }
    }
    pub fn hi(member: PKey) -> Self {
        Self {
            member,
            rel: u64::MAX,
        }
    }
}

impl Storable for MemberRelKey {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(self.into_bytes())
    }
    fn into_bytes(self) -> Vec<u8> {
        let mut v = Vec::with_capacity(Self::LEN);
        v.extend_from_slice(&self.member.0);
        v.extend_from_slice(&self.rel.to_be_bytes());
        v
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut member = [0u8; PKey::LEN];
        member.copy_from_slice(&bytes[..PKey::LEN]);
        Self {
            member: PKey(member),
            rel: u64::from_be_bytes(bytes[PKey::LEN..].try_into().unwrap()),
        }
    }
    const BOUND: Bound = Bound::Bounded {
        max_size: Self::LEN as u32,
        is_fixed_size: true,
    };
}

/// Candid-encode a record into stable memory.
///
/// `Bound::Unbounded` is deliberate. A `Bounded` bound that a long caption
/// overruns panics at `insert`, and a generous inline `max_size` bloats every
/// B-tree node whether or not the value needs the room.
macro_rules! candid_storable {
    ($t:ty) => {
        impl Storable for $t {
            fn to_bytes(&self) -> Cow<'_, [u8]> {
                Cow::Owned(candid::encode_one(self).expect("candid encode"))
            }
            fn into_bytes(self) -> Vec<u8> {
                candid::encode_one(&self).expect("candid encode")
            }
            fn from_bytes(bytes: Cow<[u8]>) -> Self {
                candid::decode_one(&bytes).expect("candid decode")
            }
            const BOUND: Bound = Bound::Unbounded;
        }
    };
}

candid_storable!(Relationship);
candid_storable!(PhotoMeta);
candid_storable!(TokenPartners);

/// Hand-written rather than generated, because [`Config`] has to decode
/// records written by older builds — see the note on [`ConfigV1`].
impl Storable for Config {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(candid::encode_one(self).expect("candid encode"))
    }
    fn into_bytes(self) -> Vec<u8> {
        candid::encode_one(&self).expect("candid encode")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        // Newest shape first, then each older one. A brand-new canister has
        // an all-zero cell, which decodes as the current shape.
        candid::decode_one::<Config>(&bytes)
            .or_else(|_| candid::decode_one::<ConfigV1>(&bytes).map(Config::from))
            .expect("stored config matches no known schema")
    }
    const BOUND: Bound = Bound::Unbounded;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip<T: Storable + PartialEq + std::fmt::Debug>(v: T)
    where
        T: Clone,
    {
        let bytes = v.to_bytes().into_owned();
        assert_eq!(T::from_bytes(Cow::Owned(bytes)), v);
    }

    #[test]
    fn pkey_roundtrips_including_the_anonymous_principal() {
        // The anonymous principal is 1 byte — the shortest thing we ever store.
        for p in [
            Principal::anonymous(),
            Principal::management_canister(),
            Principal::from_slice(&[1u8; 29]),
        ] {
            let k = PKey::from(p);
            assert_eq!(k.to_principal(), p);
            roundtrip(k);
        }
    }

    #[test]
    fn pkey_length_prefix_separates_prefix_principals() {
        // Without the length byte these two would collide after padding.
        let short = PKey::from(Principal::from_slice(&[7]));
        let long = PKey::from(Principal::from_slice(&[7, 0]));
        assert_ne!(short, long);
    }

    #[test]
    fn inbox_keys_sort_by_principal_then_id() {
        let a = PKey::from(Principal::from_slice(&[1]));
        let b = PKey::from(Principal::from_slice(&[2]));
        let mut keys = vec![
            InboxKey { who: b, rel: 1 },
            InboxKey { who: a, rel: 300 },
            InboxKey { who: a, rel: 2 },
        ];
        keys.sort_by_key(|k| k.into_bytes());
        assert_eq!(
            keys,
            vec![
                InboxKey { who: a, rel: 2 },
                // 300 after 2 only holds because the id is big-endian.
                InboxKey { who: a, rel: 300 },
                InboxKey { who: b, rel: 1 },
            ]
        );
    }

    #[test]
    fn config_decodes_a_record_written_by_the_previous_build() {
        // The exact failure that trapped post_upgrade before this impl
        // existed: a v1 record has no next_token_id or total_tokens.
        let old = ConfigV1 {
            schema_version: 1,
            next_relationship_id: 42,
            total_photos: 7,
            total_bytes: 1234,
            legacy_imported: true,
        };
        let bytes = candid::encode_one(&old).unwrap();
        let config = Config::from_bytes(Cow::Owned(bytes));
        assert_eq!(config.next_relationship_id, 42);
        assert_eq!(config.total_photos, 7);
        assert!(config.legacy_imported);
        // Backfilled, not left at zero — id 0 is the "unset" sentinel.
        assert_eq!(config.next_token_id, 1);
        assert_eq!(config.total_tokens, 0);
    }

    #[test]
    fn config_roundtrips_the_current_shape() {
        let config = Config {
            schema_version: 1,
            next_relationship_id: 9,
            total_photos: 3,
            total_bytes: 99,
            legacy_imported: false,
            next_token_id: 5,
            total_tokens: 4,
        };
        let decoded = Config::from_bytes(Cow::Owned(config.to_bytes().into_owned()));
        assert_eq!(decoded.next_token_id, 5);
        assert_eq!(decoded.total_tokens, 4);
    }

    #[test]
    fn chunk_keys_sort_by_photo_then_index() {
        // Reassembly walks this range in order, so an index that sorted as
        // little-endian would silently produce a corrupt image.
        let mut keys = vec![
            ChunkKey { rel: 1, photo: 2, idx: 3 },
            ChunkKey { rel: 1, photo: 1, idx: 300 },
            ChunkKey { rel: 1, photo: 1, idx: 2 },
        ];
        keys.sort_by_key(|k| k.into_bytes());
        assert_eq!(
            keys,
            vec![
                ChunkKey { rel: 1, photo: 1, idx: 2 },
                ChunkKey { rel: 1, photo: 1, idx: 300 },
                ChunkKey { rel: 1, photo: 2, idx: 3 },
            ]
        );
    }

    #[test]
    fn chunk_bounds_cover_exactly_one_photo() {
        assert!(ChunkKey::hi(1, 1).into_bytes() < ChunkKey::lo(1, 2).into_bytes());
        assert!(ChunkKey::hi(1, u64::MAX).into_bytes() < ChunkKey::lo(2, 0).into_bytes());
    }

    #[test]
    fn photo_bounds_cover_exactly_one_relationship() {
        assert!(PhotoKey::hi(1).into_bytes() < PhotoKey::lo(2).into_bytes());
    }

    #[test]
    fn inbox_bounds_cover_exactly_one_principal() {
        let a = PKey::from(Principal::from_slice(&[1]));
        let b = PKey::from(Principal::from_slice(&[2]));
        assert!(InboxKey::lo(a).into_bytes() <= InboxKey { who: a, rel: 5 }.into_bytes());
        assert!(InboxKey { who: a, rel: 5 }.into_bytes() <= InboxKey::hi(a).into_bytes());
        assert!(InboxKey::hi(a).into_bytes() < InboxKey::lo(b).into_bytes());
    }
}
