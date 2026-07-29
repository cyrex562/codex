# AGENTS.md

This repository is a Rust workspace for a self-hosted Obsidian-compatible knowledge app with a Vue frontend and a Tauri desktop shell.

## Repository Map

- `crates/librarium-server`: main Actix Web backend, default workspace member
- `crates/librarium-core`: platform-independent core (`AppError`, `FileService`, frontmatter read/write, Markdown render + wiki-link resolution) shared with non-server consumers; no actix/sqlx/tokio by default
- `crates/librarium-types`: shared Rust DTOs and parser traits
- `crates/librarium-client`: HTTP and WebSocket client crate
- `crates/librarium-tauri`: desktop shell that embeds the frontend and server
- `frontend`: Vue 3 + TypeScript + Vuetify SPA
- `plugins`: built-in plugin manifests and scripts
- `tests`: workspace-level Rust integration tests
- `docs/DESIGN.md`: the canonical, current design & architecture document
- `docs/archive`: historical design notes, feature plans, and superseded specs (background only)

## Working Style

- Prefer minimal, targeted changes that fit existing module boundaries.
- Treat `crates/librarium-server/src/services` as business logic, `routes` as thin transport adapters, and `models` / `librarium-types` as shared contracts.
- Keep frontend API types aligned with backend JSON shapes.
- Avoid large refactors unless the task explicitly calls for them.
- Do not edit generated build outputs in `dist/` unless the task is specifically about release artifacts.

## Build And Test

- Rust workspace check: `cargo check --workspace`
- Backend tests: `cargo test -p librarium-server`
- Workspace tests: `cargo test --workspace`
- Frontend install: `npm --prefix frontend install`
- Frontend unit tests: `npm --prefix frontend test`
- Frontend build: `npm --prefix frontend run build`
- Frontend E2E: `npm --prefix frontend run test:e2e`
- Android cross-compile check (mirrors the `android-cross-compile` CI job;
  needs an installed Android NDK, e.g. via Android Studio's SDK Manager —
  `cargo-ndk` auto-detects it from `$ANDROID_HOME`/`$ANDROID_NDK_HOME`):
  ```bash
  rustup target add aarch64-linux-android x86_64-linux-android
  cargo install cargo-ndk --locked
  cargo ndk -t aarch64-linux-android -P 21 build -p librarium-core -p librarium-sync
  cargo ndk -t x86_64-linux-android -P 21 build -p librarium-core -p librarium-sync
  ```
  To confirm no C-toolchain dependency (`openssl-sys`, `onig`) has crept back
  into these two crates:
  ```bash
  cargo tree -p librarium-core -p librarium-sync --target aarch64-linux-android -i openssl-sys
  cargo tree -p librarium-core -p librarium-sync --target aarch64-linux-android -i onig
  ```
  Both should error with "did not match any packages" (i.e. not found).

## Config And Runtime Notes

- The server reads `config.toml` by default, or `LIBRARIUM_CONFIG` / `--config`.
- Auth, JWT, LDAP, OIDC, CORS, vault paths, and TLS are configured in `crates/librarium-server/src/config/mod.rs`.
- The committed root `config.toml` is development-oriented, not a production baseline.
- File and vault operations must preserve path-safety checks in `FileService`.
- Search indexing and watcher behavior are tightly coupled to vault file mutations; changes here should be verified with integration tests.

## Code Areas To Inspect Carefully

- Auth and session behavior: `crates/librarium-server/src/routes/auth.rs`, `middleware/auth.rs`, `routes/totp.rs`
- Filesystem mutation paths: `crates/librarium-core/src/file_service.rs` (re-exported as `librarium::services::file_service`)
- Search index consistency: `crates/librarium-server/src/services/search_service.rs`
- Reindex and entity sync: `crates/librarium-server/src/services/reindex_service.rs`
- Frontend editor state and tab behavior: `frontend/src/stores`, `frontend/src/components/editor`, `frontend/src/components/tabs`

## Documentation Guardrails

- `docs/DESIGN.md` and the root `README.md` are living documents. Keep them
  describing the system **as it is now**.
- When a change is breaking or otherwise alters architecture, data flow, public
  REST/WebSocket payloads, the frontend⇄backend contract, the persistence model,
  auth/authorization, config keys, or build/run commands, **update `docs/DESIGN.md`
  in the same change** — and `README.md` too if the overview or quick start is
  affected.
- Bump the project version across `crates/*/Cargo.toml`, `frontend/package.json`,
  and `crates/librarium-tauri/tauri.conf.json` together; the `/api/version`
  endpoint derives from `CARGO_PKG_VERSION`.
- When a design note in `docs/DESIGN.md` is fully superseded, move the long-form
  detail into `docs/archive/` and leave a short pointer behind. Do not resurrect
  archived docs as the source of truth.

## Change Guardrails

- Preserve backward compatibility for API payloads unless the task explicitly includes coordinated frontend and backend changes.
- Add or update tests when modifying auth, file mutation, reindexing, search, or editor state behavior.
- Prefer fixing root causes over patching symptoms, but avoid unrelated cleanup.
- Be careful with default credentials, secrets, and security-sensitive defaults in committed config files.
