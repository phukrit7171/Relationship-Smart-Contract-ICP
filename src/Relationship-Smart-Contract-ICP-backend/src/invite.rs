//! Invite code minting, normalisation and lookup.

use crate::constants::{CODE_ALPHABET, CODE_LEN, CODE_MINT_ATTEMPTS};
use crate::errors::{Err, Res};
use crate::memory::{with_codes, with_codes_mut};
use crate::storable::CodeKey;

/// Maps one 5-bit group to a display character.
fn symbol(bits: u8) -> u8 {
    CODE_ALPHABET[(bits & 0x1f) as usize]
}

/// Accepts what a human might actually type: any case, with or without the
/// display hyphen, and with the Crockford look-alike substitutions applied.
///
/// Returns `Err::NotFound` rather than a "malformed code" error so that a
/// probe cannot tell a syntactically invalid code from a valid-but-unknown one.
pub fn normalize(raw: &str) -> Res<CodeKey> {
    let mut out = [0u8; CODE_LEN];
    let mut n = 0;
    let clean = raw.trim().split(&['?', '#'][..]).next().unwrap_or(raw);
    let clean = clean.trim_end_matches(|c| c == '/' || c == '.' || c == ' ');

    for ch in clean.chars() {
        if ch == '-' || ch == ' ' || ch == '_' {
            continue;
        }
        if n == CODE_LEN {
            return Err(Err::NotFound);
        }
        let c = ch.to_ascii_uppercase() as u8;
        let c = match c {
            b'I' | b'L' => b'1',
            b'O' => b'0',
            // U is excluded from the alphabet purely so it cannot be read as V.
            b'U' => return Err(Err::NotFound),
            other => other,
        };
        if !CODE_ALPHABET.contains(&c) {
            return Err(Err::NotFound);
        }
        out[n] = c;
        n += 1;
    }
    if n != CODE_LEN {
        return Err(Err::NotFound);
    }
    Ok(CodeKey(out))
}

/// The form shown to users and embedded in links: `XXXXX-XXXXX`.
pub fn to_display(key: &CodeKey) -> String {
    let s = std::str::from_utf8(&key.0).expect("code alphabet is ascii");
    format!("{}-{}", &s[..5], &s[5..])
}

/// Derives up to `CODE_MINT_ATTEMPTS` candidate codes from one `raw_rand`
/// call, returning the first that is not already in use.
///
/// Each code eats `CODE_LEN` bytes of entropy — one byte per symbol rather
/// than a packed 5-bit stream, because the readability of the code matters
/// more here than squeezing 32 bytes into as many codes as possible.
pub fn mint_from_entropy(entropy: &[u8]) -> Res<CodeKey> {
    let attempts = std::cmp::min(CODE_MINT_ATTEMPTS, entropy.len() / CODE_LEN);
    if attempts == 0 {
        return Err(Err::Internal("raw_rand returned too few bytes".into()));
    }
    for i in 0..attempts {
        let chunk = &entropy[i * CODE_LEN..(i + 1) * CODE_LEN];
        let mut code = [0u8; CODE_LEN];
        for (slot, byte) in code.iter_mut().zip(chunk) {
            *slot = symbol(*byte);
        }
        let key = CodeKey(code);
        if !with_codes(|m| m.contains_key(&key)) {
            return Ok(key);
        }
    }
    Err(Err::Internal(
        "could not mint an unused invite code; try again".into(),
    ))
}

pub fn bind(key: CodeKey, relationship_id: u64) {
    with_codes_mut(|m| m.insert(key, relationship_id));
}

pub fn lookup(key: &CodeKey) -> Option<u64> {
    with_codes(|m| m.get(key))
}

pub fn release(key: &CodeKey) {
    with_codes_mut(|m| m.remove(key));
}

/// Frees the code recorded on a relationship, if it still has one.
pub fn release_for(invite_code: &Option<String>) {
    if let Some(code) = invite_code {
        if let Ok(key) = normalize(code) {
            release(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(s: &str) -> CodeKey {
        normalize(s).unwrap()
    }

    #[test]
    fn normalize_accepts_the_display_form_and_lowercase() {
        assert_eq!(key("ABCDE-FGHJK"), key("abcdefghjk"));
        assert_eq!(key("ABCDE FGHJK"), key("ABCDEFGHJK"));
        assert_eq!(key("ABCDE-FGHJK/"), key("ABCDEFGHJK"));
        assert_eq!(key("ABCDE-FGHJK?igsh=123"), key("ABCDEFGHJK"));
        assert_eq!(key("ABCDE-FGHJK#fragment"), key("ABCDEFGHJK"));
        assert_eq!(key("ABCDE-FGHJK."), key("ABCDEFGHJK"));
    }

    #[test]
    fn normalize_applies_crockford_lookalikes() {
        // I, L -> 1 and O -> 0, so a code read off a screen still resolves.
        assert_eq!(key("I23456789Z"), key("123456789Z"));
        assert_eq!(key("l23456789Z"), key("123456789Z"));
        assert_eq!(key("O23456789Z"), key("023456789Z"));
    }

    #[test]
    fn normalize_rejects_wrong_length_and_stray_characters() {
        for bad in ["", "ABCDE", "ABCDEFGHJKL", "ABCDEFGHJ!", "ABCDEFGHJU"] {
            assert_eq!(normalize(bad), Err(Err::NotFound), "expected reject: {bad}");
        }
    }

    #[test]
    fn display_roundtrips_through_normalize() {
        let k = CodeKey(*b"0123456789");
        assert_eq!(to_display(&k), "01234-56789");
        assert_eq!(normalize(&to_display(&k)).unwrap(), k);
    }

    #[test]
    fn every_alphabet_symbol_survives_a_roundtrip() {
        // Catches an alphabet entry that normalize would reject or rewrite.
        for chunk in CODE_ALPHABET.chunks(CODE_LEN) {
            if chunk.len() < CODE_LEN {
                continue;
            }
            let k = CodeKey(chunk.try_into().unwrap());
            assert_eq!(normalize(&to_display(&k)).unwrap(), k);
        }
    }

    #[test]
    fn minted_symbols_all_come_from_the_alphabet() {
        // Every byte value must map into the alphabet, not just small ones.
        for b in 0..=255u8 {
            assert!(CODE_ALPHABET.contains(&symbol(b)));
        }
    }
}
