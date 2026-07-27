//! Stable memory layout.
//!
//! # The MemoryId table is permanent
//!
//! | Id | Map | Key -> Value |
//! |----|-----|--------------|
//! | 0  | `RELATIONSHIPS` | `u64` -> `Relationship` |
//! | 1  | `ACTIVE_BY`     | `PKey` -> `u64` (present only while Active) |
//! | 2  | `OUTGOING_BY`   | `PKey` -> `u64` (present only while Pending) |
//! | 3  | `INBOX`         | `InboxKey` -> `u8` (pinned invites only) |
//! | 4  | `PHOTO_META`    | `PhotoKey` -> `PhotoMeta` |
//! | 5  | `PHOTO_CHUNKS`  | `ChunkKey` -> `Vec<u8>` |
//! | 6  | `CONFIG`        | `Cell<Config>` |
//! | 7  | `INVITE_CODES`  | `CodeKey` -> `u64` (present only while Pending) |
//! | 8  | `TOKENS`        | `u64` -> `PhotoKey` |
//! | 9  | `TOKEN_PARTNERS`| `u64` -> `TokenPartners` |
//! | 10 | `OWNER_TOKENS`  | `OwnerTokenKey` -> `u8` |
//! | 11 | *reserved* | notes |
//! | 12 | *reserved* | per-member relationship index |
//!
//! Renumbering an id after data exists reinterprets some other map's bytes as
//! this one's, silently. Retired ids stay retired.
//!
//! # There is no `pre_upgrade`
//!
//! `MemoryManager` already keeps everything in stable memory. A `pre_upgrade`
//! that calls `stable_write`/`stable_save` overwrites the manager's header and
//! destroys the lot — classically on the *second* upgrade, not the first.

use crate::storable::{ChunkKey, CodeKey, InboxKey, MemberRelKey, OwnerTokenKey, PKey, PhotoKey};
use crate::types::{Config, PhotoMeta, Relationship, TokenPartners};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell};
use std::cell::RefCell;

pub type Mem = VirtualMemory<DefaultMemoryImpl>;

const MEM_RELATIONSHIPS: MemoryId = MemoryId::new(0);
const MEM_ACTIVE_BY: MemoryId = MemoryId::new(1);
const MEM_OUTGOING_BY: MemoryId = MemoryId::new(2);
const MEM_INBOX: MemoryId = MemoryId::new(3);
const MEM_PHOTO_META: MemoryId = MemoryId::new(4);
const MEM_PHOTO_CHUNKS: MemoryId = MemoryId::new(5);
const MEM_CONFIG: MemoryId = MemoryId::new(6);
const MEM_INVITE_CODES: MemoryId = MemoryId::new(7);
const MEM_TOKENS: MemoryId = MemoryId::new(8);
const MEM_TOKEN_PARTNERS: MemoryId = MemoryId::new(9);
const MEM_OWNER_TOKENS: MemoryId = MemoryId::new(10);
const MEM_MEMBER_RELATIONSHIPS: MemoryId = MemoryId::new(12);

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static RELATIONSHIPS: RefCell<StableBTreeMap<u64, Relationship, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_RELATIONSHIPS)));

    static ACTIVE_BY: RefCell<StableBTreeMap<PKey, u64, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_ACTIVE_BY)));

    static OUTGOING_BY: RefCell<StableBTreeMap<PKey, u64, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_OUTGOING_BY)));

    static INBOX: RefCell<StableBTreeMap<InboxKey, u8, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_INBOX)));

    static INVITE_CODES: RefCell<StableBTreeMap<CodeKey, u64, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_INVITE_CODES)));

    static PHOTO_META: RefCell<StableBTreeMap<PhotoKey, PhotoMeta, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_PHOTO_META)));

    // Values are Unbounded so a 256 KiB chunk lands in an overflow page
    // instead of inflating every node in the tree.
    static PHOTO_CHUNKS: RefCell<StableBTreeMap<ChunkKey, Vec<u8>, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_PHOTO_CHUNKS)));

    static TOKENS: RefCell<StableBTreeMap<u64, PhotoKey, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_TOKENS)));

    static TOKEN_PARTNERS: RefCell<StableBTreeMap<u64, TokenPartners, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_TOKEN_PARTNERS)));

    static OWNER_TOKENS: RefCell<StableBTreeMap<OwnerTokenKey, u8, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_OWNER_TOKENS)));

    static MEMBER_RELATIONSHIPS: RefCell<StableBTreeMap<MemberRelKey, u8, Mem>> =
        RefCell::new(StableBTreeMap::init(mm(MEM_MEMBER_RELATIONSHIPS)));

    static CONFIG: RefCell<StableCell<Config, Mem>> =
        RefCell::new(StableCell::init(mm(MEM_CONFIG), Config::default()));
}

fn mm(id: MemoryId) -> Mem {
    MM.with_borrow(|m| m.get(id))
}

// Accessors. Everything goes through these so no caller can hold a borrow
// across a mutation of the same map.

pub fn with_relationships<R>(f: impl FnOnce(&StableBTreeMap<u64, Relationship, Mem>) -> R) -> R {
    RELATIONSHIPS.with_borrow(f)
}
pub fn with_relationships_mut<R>(
    f: impl FnOnce(&mut StableBTreeMap<u64, Relationship, Mem>) -> R,
) -> R {
    RELATIONSHIPS.with_borrow_mut(f)
}

pub fn with_active<R>(f: impl FnOnce(&StableBTreeMap<PKey, u64, Mem>) -> R) -> R {
    ACTIVE_BY.with_borrow(f)
}
pub fn with_active_mut<R>(f: impl FnOnce(&mut StableBTreeMap<PKey, u64, Mem>) -> R) -> R {
    ACTIVE_BY.with_borrow_mut(f)
}

pub fn with_outgoing<R>(f: impl FnOnce(&StableBTreeMap<PKey, u64, Mem>) -> R) -> R {
    OUTGOING_BY.with_borrow(f)
}
pub fn with_outgoing_mut<R>(f: impl FnOnce(&mut StableBTreeMap<PKey, u64, Mem>) -> R) -> R {
    OUTGOING_BY.with_borrow_mut(f)
}

pub fn with_inbox<R>(f: impl FnOnce(&StableBTreeMap<InboxKey, u8, Mem>) -> R) -> R {
    INBOX.with_borrow(f)
}
pub fn with_inbox_mut<R>(f: impl FnOnce(&mut StableBTreeMap<InboxKey, u8, Mem>) -> R) -> R {
    INBOX.with_borrow_mut(f)
}

pub fn with_codes<R>(f: impl FnOnce(&StableBTreeMap<CodeKey, u64, Mem>) -> R) -> R {
    INVITE_CODES.with_borrow(f)
}
pub fn with_codes_mut<R>(f: impl FnOnce(&mut StableBTreeMap<CodeKey, u64, Mem>) -> R) -> R {
    INVITE_CODES.with_borrow_mut(f)
}

pub fn with_photos<R>(f: impl FnOnce(&StableBTreeMap<PhotoKey, PhotoMeta, Mem>) -> R) -> R {
    PHOTO_META.with_borrow(f)
}
pub fn with_photos_mut<R>(
    f: impl FnOnce(&mut StableBTreeMap<PhotoKey, PhotoMeta, Mem>) -> R,
) -> R {
    PHOTO_META.with_borrow_mut(f)
}

pub fn with_chunks<R>(f: impl FnOnce(&StableBTreeMap<ChunkKey, Vec<u8>, Mem>) -> R) -> R {
    PHOTO_CHUNKS.with_borrow(f)
}
pub fn with_chunks_mut<R>(
    f: impl FnOnce(&mut StableBTreeMap<ChunkKey, Vec<u8>, Mem>) -> R,
) -> R {
    PHOTO_CHUNKS.with_borrow_mut(f)
}

pub fn with_tokens<R>(f: impl FnOnce(&StableBTreeMap<u64, PhotoKey, Mem>) -> R) -> R {
    TOKENS.with_borrow(f)
}
pub fn with_tokens_mut<R>(f: impl FnOnce(&mut StableBTreeMap<u64, PhotoKey, Mem>) -> R) -> R {
    TOKENS.with_borrow_mut(f)
}

pub fn with_partners<R>(
    f: impl FnOnce(&StableBTreeMap<u64, TokenPartners, Mem>) -> R,
) -> R {
    TOKEN_PARTNERS.with_borrow(f)
}
pub fn with_partners_mut<R>(
    f: impl FnOnce(&mut StableBTreeMap<u64, TokenPartners, Mem>) -> R,
) -> R {
    TOKEN_PARTNERS.with_borrow_mut(f)
}

pub fn with_owner_tokens<R>(
    f: impl FnOnce(&StableBTreeMap<OwnerTokenKey, u8, Mem>) -> R,
) -> R {
    OWNER_TOKENS.with_borrow(f)
}
pub fn with_owner_tokens_mut<R>(
    f: impl FnOnce(&mut StableBTreeMap<OwnerTokenKey, u8, Mem>) -> R,
) -> R {
    OWNER_TOKENS.with_borrow_mut(f)
}

pub fn with_member_relationships<R>(
    f: impl FnOnce(&StableBTreeMap<MemberRelKey, u8, Mem>) -> R,
) -> R {
    MEMBER_RELATIONSHIPS.with_borrow(f)
}
pub fn with_member_relationships_mut<R>(
    f: impl FnOnce(&mut StableBTreeMap<MemberRelKey, u8, Mem>) -> R,
) -> R {
    MEMBER_RELATIONSHIPS.with_borrow_mut(f)
}

/// Reserves the next token id. Ids are never reused.
pub fn next_token_id() -> u64 {
    let mut id = 0;
    update_config(|c| {
        if c.next_token_id == 0 {
            c.next_token_id = 1;
        }
        id = c.next_token_id;
        c.next_token_id += 1;
    });
    id
}

pub fn config() -> Config {
    CONFIG.with_borrow(|c| c.get().clone())
}

pub fn update_config(f: impl FnOnce(&mut Config)) {
    CONFIG.with_borrow_mut(|c| {
        let mut cfg = c.get().clone();
        f(&mut cfg);
        c.set(cfg);
    });
}

/// Reserves the next relationship id. Ids are never reused, so a cancelled
/// invite cannot be confused with a later one.
pub fn next_relationship_id() -> u64 {
    let mut id = 0;
    update_config(|c| {
        // A canister installed before this field existed would read 0.
        if c.next_relationship_id == 0 {
            c.next_relationship_id = 1;
        }
        id = c.next_relationship_id;
        c.next_relationship_id += 1;
    });
    id
}
