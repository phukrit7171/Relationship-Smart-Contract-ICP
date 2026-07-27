#!/usr/bin/env bash
# Regenerate (or verify) relationship_backend.did from the compiled wasm.
#
# The .did is the input to the frontend's icpBindgen plugin, so it is checked
# in rather than generated at build time — which means it can silently drift
# from export_candid!(). Run with --check in CI to catch that.
set -euo pipefail

cd "$(dirname "$0")/.."

WASM=target/wasm32-unknown-unknown/release/Relationship_Smart_Contract_ICP_backend.wasm
DID=src/Relationship-Smart-Contract-ICP-backend/relationship_backend.did

cargo build --target wasm32-unknown-unknown --release \
  -p Relationship-Smart-Contract-ICP-backend

if [[ "${1:-}" == "--check" ]]; then
  candid-extractor "$WASM" | diff -u "$DID" - \
    && echo "$DID is up to date"
else
  candid-extractor "$WASM" > "$DID"
  echo "wrote $DID"
fi
