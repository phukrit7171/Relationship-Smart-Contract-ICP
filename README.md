# Relationship Smart Contract ICP

A Rust canister and Vite/React frontend deployed with the modern `icp` CLI.

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

## Useful commands

```bash
icp build
icp project show
icp canister status relationship_backend
icp network stop
```
