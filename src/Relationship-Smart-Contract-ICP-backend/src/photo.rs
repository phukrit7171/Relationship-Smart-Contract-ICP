//! Photo storage: chunked upload, quotas and retrieval.
//!
//! # Why bytes are served by query rather than `http_request`
//!
//! `http_request` is invoked by the boundary node with no caller identity, so
//! anything reachable that way is world-readable to whoever can guess the URL.
//! These are private photos, so retrieval goes through an authenticated query
//! that checks membership. The cost is that query responses are uncertified —
//! mitigated by agent-js verifying node signatures, and by the client
//! re-hashing the reassembled bytes against `PhotoMeta.sha256`.
//!
//! Phase 7 adds `http_request` for photos explicitly flagged `is_public`.

use crate::constants::*;
use crate::errors::{check_len, Err, Res};
use crate::memory::*;
use crate::relationship;
use crate::sha256::sha256;
use crate::storable::{ChunkKey, PhotoKey};
use crate::types::*;
use candid::Principal;
use ic_cdk::api::time;

fn key(rel: u64, photo: u64) -> PhotoKey {
    PhotoKey { rel, photo }
}

pub fn get_meta(rel: u64, photo: u64) -> Res<PhotoMeta> {
    with_photos(|m| m.get(&key(rel, photo))).ok_or(Err::NotFound)
}

fn put_meta(meta: &PhotoMeta) {
    with_photos_mut(|m| m.insert(key(meta.relationship_id, meta.photo_id), meta.clone()));
}

/// Loads the relationship and checks the caller belongs to it.
fn member_relationship(caller: Principal, rel_id: u64) -> Res<Relationship> {
    let rel = relationship::get(rel_id)?;
    if !rel.is_member(caller) {
        return Err(Err::NotAMember);
    }
    Ok(rel)
}

/// Uploads require an *active* relationship. Reads do not — an ended
/// relationship stays browsable, it just stops accepting new photos.
fn writable_relationship(caller: Principal, rel_id: u64) -> Res<Relationship> {
    let rel = member_relationship(caller, rel_id)?;
    if rel.status != RelStatus::Active {
        return Err(Err::InvalidState(format!(
            "this relationship is {:?}; photos can no longer be added",
            rel.status
        )));
    }
    Ok(rel)
}

/// There is no `remove_range`, and a `range` iterator cannot be held across
/// `borrow_mut`, so keys are collected first.
fn drop_chunks(rel: u64, photo: u64) {
    let keys: Vec<ChunkKey> = with_chunks(|m| {
        m.range(ChunkKey::lo(rel, photo)..=ChunkKey::hi(rel, photo))
            .map(|e| *e.key())
            .collect()
    });
    with_chunks_mut(|m| {
        for k in keys {
            m.remove(&k);
        }
    });
}

/// Discards half-finished uploads in this relationship that were abandoned
/// more than `MAX_UPLOAD_AGE_NS` ago.
///
/// Called at the start of each new upload rather than from a timer: nothing
/// observes the wasted space in between, so there is nothing for a timer to
/// be timely about.
fn sweep_stale_uploads(rel_id: u64, now: u64) {
    let stale: Vec<PhotoMeta> = with_photos(|m| {
        m.range(PhotoKey::lo(rel_id)..=PhotoKey::hi(rel_id))
            .map(|e| e.value())
            .filter(|p| {
                p.state == PhotoState::Uploading
                    && now.saturating_sub(p.uploaded_at) > MAX_UPLOAD_AGE_NS
            })
            .collect()
    });
    for photo in stale {
        drop_chunks(rel_id, photo.photo_id);
        with_photos_mut(|m| m.remove(&key(rel_id, photo.photo_id)));
    }
}

fn expected_chunk_count(total_bytes: u64) -> u32 {
    total_bytes.div_ceil(CHUNK_SIZE as u64).max(1) as u32
}

fn validate_draft(draft: &PhotoDraft) -> Res<()> {
    check_len("caption", &draft.caption, MAX_CAPTION_CHARS)?;

    if !ALLOWED_CONTENT_TYPES.contains(&draft.content_type.as_str()) {
        return Err(Err::UnsupportedContentType(format!(
            "{} is not one of {}",
            draft.content_type,
            ALLOWED_CONTENT_TYPES.join(", ")
        )));
    }
    if draft.total_bytes == 0 {
        return Err(Err::Invalid("an empty photo is not a photo".into()));
    }
    if draft.total_bytes > MAX_PHOTO_BYTES {
        return Err(Err::TooLarge {
            limit: MAX_PHOTO_BYTES,
            got: draft.total_bytes,
        });
    }
    // Both checks matter: the first stops a lying chunk_count, the second is
    // an absolute ceiling that holds even if MAX_PHOTO_BYTES is ever raised.
    if draft.chunk_count != expected_chunk_count(draft.total_bytes) {
        return Err(Err::BadChunk(format!(
            "chunk_count {} does not match {} bytes at {CHUNK_SIZE} per chunk",
            draft.chunk_count, draft.total_bytes
        )));
    }
    if draft.chunk_count > MAX_CHUNKS_PER_PHOTO {
        return Err(Err::BadChunk(format!(
            "at most {MAX_CHUNKS_PER_PHOTO} chunks per photo"
        )));
    }
    if draft.width == 0 || draft.height == 0 {
        return Err(Err::Invalid("width and height are required".into()));
    }
    // Baseline validation for photo timestamp (must be non-zero and not far in the future)
    if draft.taken_at > 0 {
        let now = time();
        let max_future = now.saturating_add(86_400 * NS_PER_SEC);
        if draft.taken_at > max_future {
            return Err(Err::Invalid("photo taken_at timestamp is in the far future".into()));
        }
    }
    Ok(())
}

fn check_quotas(rel: &Relationship, incoming: u64) -> Res<()> {
    if rel.photo_count >= MAX_PHOTOS_PER_REL {
        return Err(Err::QuotaExceeded(format!(
            "this relationship already holds the maximum of {MAX_PHOTOS_PER_REL} photos"
        )));
    }
    if rel.bytes_used + incoming > MAX_BYTES_PER_REL {
        return Err(Err::QuotaExceeded(format!(
            "this relationship's {} MiB of photo storage is full",
            MAX_BYTES_PER_REL / (1024 * 1024)
        )));
    }
    if config().total_bytes + incoming > MAX_TOTAL_BYTES {
        return Err(Err::QuotaExceeded(
            "this canister has reached its storage ceiling".into(),
        ));
    }
    Ok(())
}

/// Reserves a photo id and writes the `Uploading` record that doubles as the
/// upload session — there is no separate session map to keep in step.
pub fn start_upload(caller: Principal, draft: PhotoDraft) -> Res<u64> {
    let now = time();
    validate_draft(&draft)?;
    let mut rel = writable_relationship(caller, draft.relationship_id)?;
    sweep_stale_uploads(rel.id, now);

    // Limit at most one concurrent in-flight upload per relationship to prevent storage flooding
    let has_uploading = with_photos(|m| {
        m.range(PhotoKey::lo(rel.id)..=PhotoKey::hi(rel.id))
            .any(|e| e.value().state == PhotoState::Uploading)
    });
    if has_uploading {
        return Err(Err::QuotaExceeded(
            "an upload is already in progress for this relationship".into(),
        ));
    }

    check_quotas(&rel, draft.total_bytes)?;

    let photo_id = rel.next_photo_id;
    rel.next_photo_id += 1;
    relationship::put(&rel);

    put_meta(&PhotoMeta {
        photo_id,
        relationship_id: rel.id,
        uploader: caller,
        kind: draft.kind,
        caption: draft.caption,
        taken_at: draft.taken_at,
        uploaded_at: now,
        content_type: draft.content_type,
        total_bytes: draft.total_bytes,
        chunk_count: draft.chunk_count,
        received_chunks: 0,
        width: draft.width,
        height: draft.height,
        sha256: Vec::new(),
        state: PhotoState::Uploading,
        is_public: false,
        token_id: None,
    });
    Ok(photo_id)
}

/// Writes one chunk. Idempotent, and chunks may arrive in any order or in
/// parallel — each is an independent key.
pub fn put_chunk(caller: Principal, args: ChunkArgs) -> Res<()> {
    member_relationship(caller, args.relationship_id)?;
    let mut meta = get_meta(args.relationship_id, args.photo_id)?;
    if meta.state != PhotoState::Uploading {
        return Err(Err::InvalidState("this upload is already finished".into()));
    }
    if args.chunk_index >= meta.chunk_count {
        return Err(Err::BadChunk(format!(
            "chunk {} is out of range; this photo has {}",
            args.chunk_index, meta.chunk_count
        )));
    }

    // Every chunk but the last must be exactly CHUNK_SIZE, so the byte offset
    // of each one is implied by its index and reassembly needs no lengths.
    let is_last = args.chunk_index == meta.chunk_count - 1;
    let expected = if is_last {
        meta.total_bytes - (args.chunk_index as u64) * (CHUNK_SIZE as u64)
    } else {
        CHUNK_SIZE as u64
    };
    if args.data.len() as u64 != expected {
        return Err(Err::BadChunk(format!(
            "chunk {} should be {expected} bytes, got {}",
            args.chunk_index,
            args.data.len()
        )));
    }

    let chunk_key = ChunkKey {
        rel: args.relationship_id,
        photo: args.photo_id,
        idx: args.chunk_index,
    };
    let is_new = !with_chunks(|m| m.contains_key(&chunk_key));
    with_chunks_mut(|m| m.insert(chunk_key, args.data));
    if is_new {
        meta.received_chunks += 1;
        put_meta(&meta);
    }
    Ok(())
}

/// Seals the upload: hashes the reassembled bytes, flips to `Complete` and
/// charges the quota counters.
pub fn finish_upload(caller: Principal, r: PhotoRef) -> Res<PhotoMeta> {
    let mut rel = writable_relationship(caller, r.relationship_id)?;
    let mut meta = get_meta(r.relationship_id, r.photo_id)?;
    if meta.state == PhotoState::Complete {
        return Ok(meta);
    }
    if meta.received_chunks != meta.chunk_count {
        return Err(Err::BadChunk(format!(
            "{} of {} chunks received",
            meta.received_chunks, meta.chunk_count
        )));
    }

    let bytes = read_all_chunks(r.relationship_id, r.photo_id, &meta)?;
    meta.sha256 = sha256(&bytes).to_vec();
    meta.state = PhotoState::Complete;
    meta.uploaded_at = time();

    rel.photo_count += 1;
    rel.bytes_used += meta.total_bytes;
    if meta.kind == PhotoKind::First && rel.first_photo_id.is_none() {
        rel.first_photo_id = Some(meta.photo_id);
    }
    relationship::put(&rel);
    update_config(|c| {
        c.total_photos += 1;
        c.total_bytes += meta.total_bytes;
    });
    put_meta(&meta);
    Ok(meta)
}

fn read_all_chunks(rel: u64, photo: u64, meta: &PhotoMeta) -> Res<Vec<u8>> {
    let mut bytes = Vec::with_capacity(meta.total_bytes as usize);
    for idx in 0..meta.chunk_count {
        let chunk = with_chunks(|m| m.get(&ChunkKey { rel, photo, idx }))
            .ok_or_else(|| Err::Internal(format!("chunk {idx} is missing")))?;
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() as u64 != meta.total_bytes {
        return Err(Err::Internal(format!(
            "reassembled {} bytes, expected {}",
            bytes.len(),
            meta.total_bytes
        )));
    }
    Ok(bytes)
}

pub fn abort_upload(caller: Principal, r: PhotoRef) -> Res<()> {
    member_relationship(caller, r.relationship_id)?;
    let meta = get_meta(r.relationship_id, r.photo_id)?;
    if meta.state == PhotoState::Complete {
        return Err(Err::InvalidState(
            "this upload is finished; use delete_photo".into(),
        ));
    }
    drop_chunks(r.relationship_id, r.photo_id);
    with_photos_mut(|m| m.remove(&key(r.relationship_id, r.photo_id)));
    Ok(())
}

/// start + all chunks + finish in a single update.
///
/// Almost every compressed photo fits in one chunk, and this turns a four
/// round-trip, ~10 second upload into a single ~2 second one.
pub fn upload_one_shot(
    caller: Principal,
    draft: PhotoDraft,
    bytes: Vec<u8>,
) -> Res<PhotoMeta> {
    if bytes.len() as u64 != draft.total_bytes {
        return Err(Err::BadChunk(format!(
            "declared {} bytes but sent {}",
            draft.total_bytes,
            bytes.len()
        )));
    }
    if bytes.len() > CHUNK_SIZE {
        return Err(Err::TooLarge {
            limit: CHUNK_SIZE as u64,
            got: bytes.len() as u64,
        });
    }
    let relationship_id = draft.relationship_id;
    let photo_id = start_upload(caller, draft)?;
    put_chunk(
        caller,
        ChunkArgs {
            relationship_id,
            photo_id,
            chunk_index: 0,
            data: bytes,
        },
    )?;
    finish_upload(
        caller,
        PhotoRef {
            relationship_id,
            photo_id,
        },
    )
}

/// Metadata for the whole timeline, ordered by when the moment happened.
///
/// Metadata only: 200 records is roughly 60 KB, comfortably inside the query
/// response limit, whereas the bytes themselves never would be.
pub fn list(caller: Principal, rel_id: u64) -> Res<Vec<PhotoMeta>> {
    member_relationship(caller, rel_id)?;
    let mut photos: Vec<PhotoMeta> = with_photos(|m| {
        m.range(PhotoKey::lo(rel_id)..=PhotoKey::hi(rel_id))
            .map(|e| e.value())
            .filter(|p| p.state == PhotoState::Complete)
            .collect()
    });
    // photo_id breaks ties so two photos taken at the same moment keep a
    // stable order between calls.
    photos.sort_by_key(|p| (p.taken_at, p.photo_id));
    Ok(photos)
}

pub fn read_meta(caller: Principal, r: PhotoRef) -> Res<PhotoMeta> {
    member_relationship(caller, r.relationship_id)?;
    get_meta(r.relationship_id, r.photo_id)
}

pub fn read_chunk(caller: Principal, r: ChunkRef) -> Res<Vec<u8>> {
    member_relationship(caller, r.relationship_id)?;
    with_chunks(|m| {
        m.get(&ChunkKey {
            rel: r.relationship_id,
            photo: r.photo_id,
            idx: r.chunk_index,
        })
    })
    .ok_or(Err::NotFound)
}

pub fn patch(caller: Principal, p: PhotoPatch) -> Res<()> {
    check_len("caption", &p.caption, MAX_CAPTION_CHARS)?;
    let mut rel = member_relationship(caller, p.relationship_id)?;
    let mut meta = get_meta(p.relationship_id, p.photo_id)?;

    if meta.token_id.is_some() {
        return Err(Err::Forbidden(
            "this photo was minted as a keepsake and its metadata is immutable".into(),
        ));
    }

    // At most one First photo per relationship, so promoting one has to
    // demote whichever held the slot.
    if p.kind == PhotoKind::First && meta.kind != PhotoKind::First {
        if let Some(previous_id) = rel.first_photo_id {
            if let Ok(mut previous) = get_meta(p.relationship_id, previous_id) {
                previous.kind = PhotoKind::Memory;
                put_meta(&previous);
            }
        }
        rel.first_photo_id = Some(meta.photo_id);
        relationship::put(&rel);
    } else if p.kind != PhotoKind::First && rel.first_photo_id == Some(meta.photo_id) {
        rel.first_photo_id = None;
        relationship::put(&rel);
    }

    meta.caption = p.caption;
    meta.taken_at = p.taken_at;
    meta.kind = p.kind;
    put_meta(&meta);
    Ok(())
}

pub fn delete(caller: Principal, r: PhotoRef) -> Res<()> {
    let mut rel = member_relationship(caller, r.relationship_id)?;
    let meta = get_meta(r.relationship_id, r.photo_id)?;

    // Minting is irreversible by design, and that promise is only worth
    // anything if the image cannot then be deleted out from under the token.
    if meta.token_id.is_some() {
        return Err(Err::Forbidden(
            "this photo was minted as a keepsake and can no longer be deleted".into(),
        ));
    }

    // You may always delete your own. The partner may delete anything except
    // the photo from the day it started, while it is still going.
    let is_uploader = meta.uploader == caller;
    if !is_uploader
        && meta.kind == PhotoKind::First
        && rel.status == RelStatus::Active
    {
        return Err(Err::Forbidden(
            "only the person who uploaded it can delete the first photo".into(),
        ));
    }

    drop_chunks(r.relationship_id, r.photo_id);
    with_photos_mut(|m| m.remove(&key(r.relationship_id, r.photo_id)));

    if meta.state == PhotoState::Complete {
        rel.photo_count = rel.photo_count.saturating_sub(1);
        rel.bytes_used = rel.bytes_used.saturating_sub(meta.total_bytes);
        if rel.first_photo_id == Some(meta.photo_id) {
            rel.first_photo_id = None;
        }
        relationship::put(&rel);
        update_config(|c| {
            c.total_photos = c.total_photos.saturating_sub(1);
            // Note this frees B-tree pages for reuse but does not return
            // stable memory to the subnet; bill against stable_size().
            c.total_bytes = c.total_bytes.saturating_sub(meta.total_bytes);
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_count_covers_the_boundaries() {
        assert_eq!(expected_chunk_count(1), 1);
        assert_eq!(expected_chunk_count(CHUNK_SIZE as u64), 1);
        // One byte over a chunk boundary needs a second chunk.
        assert_eq!(expected_chunk_count(CHUNK_SIZE as u64 + 1), 2);
        assert_eq!(expected_chunk_count(2 * CHUNK_SIZE as u64), 2);
        // Zero is rejected by validate_draft, but must not report zero chunks.
        assert_eq!(expected_chunk_count(0), 1);
    }

    fn draft(total_bytes: u64, chunk_count: u32) -> PhotoDraft {
        PhotoDraft {
            relationship_id: 1,
            kind: PhotoKind::Memory,
            caption: String::new(),
            taken_at: 0,
            content_type: "image/webp".into(),
            total_bytes,
            chunk_count,
            width: 100,
            height: 100,
        }
    }

    #[test]
    fn validate_draft_accepts_a_well_formed_photo() {
        assert!(validate_draft(&draft(1000, 1)).is_ok());
    }

    #[test]
    fn validate_draft_rejects_a_mismatched_chunk_count() {
        // The defence against a client claiming more chunks than its bytes need.
        assert!(matches!(
            validate_draft(&draft(1000, 4)),
            Err(Err::BadChunk(_))
        ));
    }

    #[test]
    fn validate_draft_rejects_empty_and_oversized_photos() {
        assert!(matches!(validate_draft(&draft(0, 1)), Err(Err::Invalid(_))));
        assert!(matches!(
            validate_draft(&draft(MAX_PHOTO_BYTES + 1, 2)),
            Err(Err::TooLarge { .. })
        ));
    }

    #[test]
    fn validate_draft_rejects_an_unlisted_content_type() {
        let mut d = draft(1000, 1);
        d.content_type = "image/gif".into();
        assert!(matches!(
            validate_draft(&d),
            Err(Err::UnsupportedContentType(_))
        ));
    }

    #[test]
    fn validate_draft_requires_dimensions() {
        let mut d = draft(1000, 1);
        d.width = 0;
        assert!(matches!(validate_draft(&d), Err(Err::Invalid(_))));
    }
}
