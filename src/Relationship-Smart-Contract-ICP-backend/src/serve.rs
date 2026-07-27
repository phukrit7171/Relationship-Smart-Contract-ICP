//! Certified HTTP serving for photos minted as keepsakes.
//!
//! Everything here applies **only** to photos with `is_public`, which a couple
//! sets deliberately by minting a keepsake. Private photos are never reachable
//! through this path — `http_request` carries no caller identity, so it cannot
//! make an authorisation decision, and anything served here is readable by
//! anyone who knows the URL.
//!
//! An NFT needs an image URL a wallet can load, which is the whole reason this
//! exists.
//!
//! # The tree lives in the heap
//!
//! `HttpCertificationTree` is not stable-memory backed, so it is discarded on
//! upgrade and rebuilt in `post_upgrade` from the `is_public` photos in stable
//! memory. That is affordable because keepsakes are opt-in and rare; a
//! canister with tens of thousands would need a different approach.

use crate::memory::{with_chunks, with_photos};
use crate::storable::ChunkKey;
use crate::types::{PhotoMeta, PhotoState};
use ic_cdk::api::{certified_data_set, data_certificate};
use ic_http_certification::utils::add_v2_certificate_header;
use ic_http_certification::{
    DefaultCelBuilder, DefaultResponseCertification, DefaultResponseOnlyCelExpression,
    HttpCertification, HttpCertificationPath, HttpCertificationTree,
    HttpCertificationTreeEntry, HttpRequest, HttpResponse, StatusCode,
};
use std::cell::RefCell;

thread_local! {
    static TREE: RefCell<HttpCertificationTree> =
        RefCell::new(HttpCertificationTree::default());
}

/// Certifies the response only — the request contributes nothing here, since
/// every public photo is a plain GET with no headers or query that could
/// change what comes back.
fn cel_expression() -> DefaultResponseOnlyCelExpression<'static> {
    DefaultCelBuilder::response_only_certification()
        .with_response_certification(DefaultResponseCertification::certified_response_headers(
            vec!["content-type", "cache-control"],
        ))
        .build()
}

pub fn photo_path(relationship_id: u64, photo_id: u64) -> String {
    format!("/photo/{relationship_id}/{photo_id}")
}

/// Reassembles a photo's bytes. Returns `None` if any chunk is missing.
fn read_bytes(meta: &PhotoMeta) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(meta.total_bytes as usize);
    for idx in 0..meta.chunk_count {
        let chunk = with_chunks(|m| {
            m.get(&ChunkKey {
                rel: meta.relationship_id,
                photo: meta.photo_id,
                idx,
            })
        })?;
        bytes.extend_from_slice(&chunk);
    }
    Some(bytes)
}

/// The exact response bytes and headers that get certified, and that
/// `http_request` must reproduce byte for byte or verification fails.
fn build_response(meta: &PhotoMeta, body: Vec<u8>) -> HttpResponse<'static> {
    HttpResponse::builder()
        .with_status_code(StatusCode::OK)
        .with_headers(vec![
            ("content-type".to_string(), meta.content_type.clone()),
            // Keepsakes are immutable once minted, so this can be aggressive.
            (
                "cache-control".to_string(),
                "public, max-age=31536000, immutable".to_string(),
            ),
            (
                "ic-certificateexpression".to_string(),
                cel_expression().to_string(),
            ),
        ])
        .with_body(body)
        .build()
}

/// Adds a photo to the certification tree and republishes the root hash.
///
/// Must run in the same update call that flips `is_public`; otherwise queries
/// for it would return a response the tree doesn't cover, and every one of
/// them would fail verification.
pub fn certify(meta: &PhotoMeta) {
    let Some(body) = read_bytes(meta) else { return };
    let path = photo_path(meta.relationship_id, meta.photo_id);
    let cel = cel_expression();
    let response = build_response(meta, body);
    let certification = HttpCertification::response_only(&cel, &response, None)
        .expect("response-only certification cannot fail for a well-formed response");

    TREE.with_borrow_mut(|tree| {
        tree.insert(&HttpCertificationTreeEntry::new(
            HttpCertificationPath::exact(&path),
            certification,
        ));
        certified_data_set(tree.root_hash());
    });
}

// There is deliberately no `uncertify`. A photo only enters this tree by
// being minted as a keepsake, and `photo::delete` refuses to remove a minted
// photo — an NFT whose image can disappear is not worth minting.

/// Rebuilds the whole tree from stable memory. Called from `post_upgrade`.
pub fn rebuild() {
    TREE.with_borrow_mut(|tree| {
        tree.clear();
        certify_not_found(tree);
    });
    let public: Vec<PhotoMeta> = with_photos(|m| {
        m.iter()
            .map(|e| e.value())
            .filter(|p| p.is_public && p.state == PhotoState::Complete)
            .collect()
    });
    for meta in &public {
        certify(meta);
    }
    // Even with nothing public, the root hash must be published so the
    // boundary node sees a valid (empty) tree rather than none at all.
    TREE.with_borrow(|tree| certified_data_set(tree.root_hash()));
}

fn parse_photo_path(url: &str) -> Option<(u64, u64)> {
    let path = url.split(['?', '#']).next()?;
    let mut parts = path.trim_start_matches('/').split('/');
    if parts.next()? != "photo" {
        return None;
    }
    let rel = parts.next()?.parse().ok()?;
    let photo = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((rel, photo))
}

/// Every URL that isn't a public photo — private photos, unknown ids, junk
/// paths — resolves here.
///
/// It has to be certified like anything else. An uncertified response fails
/// verification at the boundary node, which turns it into a 503; the caller
/// then can't tell "no such photo" from "the canister is broken".
const NOT_FOUND_BODY: &[u8] = b"not found";

fn build_not_found() -> HttpResponse<'static> {
    HttpResponse::builder()
        .with_status_code(StatusCode::NOT_FOUND)
        .with_headers(vec![
            ("content-type".to_string(), "text/plain".to_string()),
            ("cache-control".to_string(), "no-store".to_string()),
            (
                "ic-certificateexpression".to_string(),
                cel_expression().to_string(),
            ),
        ])
        .with_body(NOT_FOUND_BODY.to_vec())
        .build()
}

/// Matches any path no exact entry covers.
fn fallback_path() -> HttpCertificationPath<'static> {
    HttpCertificationPath::wildcard("")
}

fn certify_not_found(tree: &mut HttpCertificationTree) {
    let response = build_not_found();
    let certification = HttpCertification::response_only(&cel_expression(), &response, None)
        .expect("response-only certification cannot fail for a well-formed response");
    tree.insert(&HttpCertificationTreeEntry::new(
        fallback_path(),
        certification,
    ));
}

fn not_found(url: &str) -> HttpResponse<'static> {
    let mut response = build_not_found();
    let certification = HttpCertification::response_only(&cel_expression(), &response, None)
        .expect("response-only certification cannot fail for a well-formed response");
    let entry = HttpCertificationTreeEntry::new(fallback_path(), certification);

    if let Some(certificate) = data_certificate() {
        let path = url.split(['?', '#']).next().unwrap_or("/");
        if let Ok(witness) = TREE.with_borrow(|tree| tree.witness(&entry, path)) {
            add_v2_certificate_header(
                &certificate,
                &mut response,
                &witness,
                &fallback_path().to_expr_path(),
            );
        }
    }
    response
}

pub fn handle(request: &HttpRequest) -> HttpResponse<'static> {
    let Some((rel, photo)) = parse_photo_path(request.url()) else {
        return not_found(request.url());
    };
    let Some(meta) = with_photos(|m| m.get(&crate::storable::PhotoKey { rel, photo })) else {
        return not_found(request.url());
    };
    // The `is_public` gate. Without it this endpoint would hand out every
    // couple's private photos to anyone who could count.
    if !meta.is_public || meta.state != PhotoState::Complete {
        return not_found(request.url());
    }
    let Some(body) = read_bytes(&meta) else {
        return not_found(request.url());
    };

    let mut response = build_response(&meta, body);
    let path = photo_path(rel, photo);
    let cel = cel_expression();
    let certification = HttpCertification::response_only(&cel, &response, None)
        .expect("response-only certification cannot fail for a well-formed response");
    let entry = HttpCertificationTreeEntry::new(
        HttpCertificationPath::exact(&path),
        certification,
    );

    if let Some(certificate) = data_certificate() {
        let witness = TREE.with_borrow(|tree| tree.witness(&entry, &path));
        if let Ok(witness) = witness {
            add_v2_certificate_header(
                &certificate,
                &mut response,
                &witness,
                &HttpCertificationPath::exact(&path).to_expr_path(),
            );
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_photo_path() {
        assert_eq!(parse_photo_path("/photo/1/2"), Some((1, 2)));
        assert_eq!(parse_photo_path("/photo/12/345?v=1"), Some((12, 345)));
    }

    #[test]
    fn rejects_anything_else() {
        // Extra segments and non-numeric ids must not resolve to a photo.
        for bad in [
            "/",
            "/photo",
            "/photo/1",
            "/photo/1/2/3",
            "/photos/1/2",
            "/photo/a/2",
            "/photo/1/-2",
            "/photo/../1",
        ] {
            assert_eq!(parse_photo_path(bad), None, "expected reject: {bad}");
        }
    }
}
