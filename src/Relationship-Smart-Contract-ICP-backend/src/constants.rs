//! Tunables. Anything that shows up in a validation error lives here.

/// Current on-disk schema. Bump when a stored record's shape changes and add a
/// migration arm in `post_upgrade`.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

pub const MAX_MESSAGE_CHARS: usize = 500;
pub const MAX_TITLE_CHARS: usize = 64;
pub const MAX_END_REASON_CHARS: usize = 300;

/// How many closed relationships `get_my_state` hands back.
pub const MAX_HISTORY_ITEMS: usize = 20;

// --- invite codes ---

/// Crockford base32 minus I, L, O and U: no character can be confused with
/// another when someone reads a code out loud or types it from a screenshot.
pub const CODE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// 10 symbols x 5 bits = 50 bits of entropy.
pub const CODE_LEN: usize = 10;
/// `raw_rand` gives 32 bytes; that is 6 candidate codes per call, so a collision
/// retry costs nothing extra unless we burn through all of them.
pub const CODE_MINT_ATTEMPTS: usize = 5;

// --- photos ---

/// One chunk per ingress message. The ~2 MiB ingress limit covers the whole
/// signed envelope, not just the payload, so this leaves generous headroom.
pub const CHUNK_SIZE: usize = 256 * 1024;
/// Roughly 500 KB. The client compresses well below this; the cap is a
/// backstop, not the target.
pub const MAX_PHOTO_BYTES: u64 = 512_000;
/// Hard ceiling independent of `MAX_PHOTO_BYTES`, so a lying `chunk_count`
/// cannot make the canister allocate an unbounded number of chunk rows.
pub const MAX_CHUNKS_PER_PHOTO: u32 = 4;
pub const MAX_PHOTOS_PER_REL: u32 = 200;
pub const MAX_BYTES_PER_REL: u64 = 50 * 1024 * 1024;
/// Canister-wide circuit breaker: ~USD 22/year of storage at full.
pub const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const ALLOWED_CONTENT_TYPES: [&str; 3] = ["image/webp", "image/jpeg", "image/png"];
pub const MAX_CAPTION_CHARS: usize = 300;
/// An upload left half-finished for this long is swept on the next one.
pub const MAX_UPLOAD_AGE_NS: u64 = 3_600_000_000_000;

pub const NS_PER_SEC: u64 = 1_000_000_000;
/// Default invite lifetime: 30 days.
pub const DEFAULT_TTL_SECONDS: u64 = 30 * 24 * 60 * 60;
/// Refuse absurd TTLs rather than silently clamping — an invite that outlives
/// the couple's memory of sending it is worse than an error.
pub const MAX_TTL_SECONDS: u64 = 365 * 24 * 60 * 60;
pub const MIN_TTL_SECONDS: u64 = 60;
