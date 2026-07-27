# Relationship Smart Contract ICP

A Rust canister and Vite/React frontend deployed with the modern `icp` CLI.

One person signs in with Internet Identity and creates a proposal, which mints
a shareable invite link. The other opens the link, signs in, and accepts. Both
principals are recorded on-chain, in stable memory, and survive upgrades.

## What it does

- **Invite links.** The proposer never needs to know the other person's
  Principal ID — nobody knows their own. Codes are 10 Crockford base32
  characters (50 bits from `raw_rand`), single-use, and expire. Optionally
  pinned to one principal.
- **Many couples per canister.** Keyed by an incrementing relationship id with
  index maps for active, outgoing and inbox lookups.
- **Photos on-chain.** A first photo plus an anniversary timeline, stored in
  stable memory, compressed client-side, chunked at 256 KiB, and hashed so the
  browser can verify what it reassembles.
- **Anniversary countdown, in-app only.** No timers, no outcalls, no push —
  everything derives from `accepted_at` on the client.
- **Soulbound keepsakes.** Milestone photos can be minted as ICRC-7 tokens held
  by both partners. Transfers always fail; minting is irreversible and makes
  that one photo publicly servable.

## Architecture notes

Three decisions the code depends on, each documented at length in the module
that implements it:

- **`memory.rs` owns a permanent `MemoryId` table.** Renumbering an id after
  data exists silently reinterprets another map's bytes. There is deliberately
  no `pre_upgrade`.
- **Photos are served by authenticated query, not `http_request`.** The
  boundary node calls `http_request` anonymously, so it cannot authorise
  anyone. Only photos explicitly minted as keepsakes are reachable that way,
  and those are certified (`serve.rs`).
- **Stored records need a decode fallback when they gain a field.** Candid
  cannot read an old record into a struct with a new non-`opt` field, and the
  config cell is decoded during `thread_local` setup — before `post_upgrade`
  could intervene. See `ConfigV1` in `types.rs`.

## Tests

```bash
cargo test                                              # backend unit tests
npm test --workspace Relationship-Smart-Contract-ICP-frontend
./scripts/did.sh --check                                # .did matches the wasm
```

`scripts/did.sh` regenerates `relationship_backend.did` from the compiled wasm.
The `.did` is checked in because the frontend's bindgen plugin reads it, so it
can drift from `export_candid!()` — run the check in CI.

## Prerequisites

- Node.js 22 or later
- Rust with `wasm32-unknown-unknown` installed
- `icp` CLI and `ic-wasm`:

  ```bash
  npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm
  rustup target add wasm32-unknown-unknown
  ```

## Local development

Install JavaScript dependencies, start this project's local network, then deploy:

```bash
npm ci
icp network start -d
icp deploy
```

The deployed frontend is available at:

```text
http://<frontend-canister-id>.localhost:8000
```

Use `icp canister status relationship_frontend -i` to print the local frontend canister ID. The `icp network status --json` command reports the active local gateway URL if the port is configured differently.

For frontend-only development, deploy the backend first, then run Vite:

```bash
icp deploy relationship_backend
npm start
```

The Vite configuration obtains the local network URL, root key, and backend canister ID from `icp`; it exposes them to the app through the same `ic_env` cookie used by the asset canister in deployed environments.

## Deployment

Deploy the full project to the configured local environment:

```bash
icp deploy
```

To deploy the existing mainnet canisters, first select a funded named identity, then deploy to the `ic` environment:

```bash
icp identities list
icp identity default <identity-name>
icp deploy -e ic
```

The mainnet canister mappings are tracked in `.icp/data/mappings/ic.ids.json`. Keep that file under version control.

`icp deploy` refuses when a returned Candid variant gains cases, which this
backend's `Err` type does as features land. The JS client handles unknown error
kinds with a generic message, so pass `--yes` once you have read the diff.

### Migrating the existing mainnet canister

The canister deployed before this overhaul kept its state in the Wasm heap with
no `pre_upgrade`. **No code in the new build can recover it** — the hook that
would have to run lives in the *old* wasm, which doesn't have one. Read the
values off the live canister first:

```bash
icp canister call relationship_backend get_status --query -e ic
icp canister snapshot create relationship_backend -e ic
```

Record `accepted_time` (nanoseconds) and `accepted_by`. The proposer was never
stored, so supply your own principal. Then deploy and re-seed:

```bash
icp deploy -e ic --yes
icp canister call relationship_backend admin_import_legacy \
  '(record { proposer = principal "<you>"; recipient = principal "<them>"; \
     accepted_at = <ns>; message = "..."; title = "..." })' -e ic
```

`admin_import_legacy` is controller-only and runs once. Verify with
`get_my_state` from both principals, then delete the snapshot — snapshots cost
storage.

The deprecated `get_status` shim keeps the currently-deployed frontend build
working in the window between the backend and frontend deploys. Drop it once
the new asset build is live everywhere.

## Useful commands

```bash
icp build
icp project show
icp canister status relationship_backend
icp network stop
```
