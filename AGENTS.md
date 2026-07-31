# AGENTS.md

This repository is a Rust workspace for a self-hosted Obsidian-compatible knowledge app with a Vue frontend and a Tauri desktop shell.

## Repository Map

- `crates/librarium-server`: main Actix Web backend, default workspace member
- `crates/librarium-core`: platform-independent core (`AppError`, `FileService`, frontmatter read/write, Markdown render + wiki-link resolution, Tantivy search behind a default-on `search` feature) shared with non-server consumers; no actix/sqlx/tokio by default
- `crates/librarium-types`: shared Rust DTOs and parser traits
- `crates/librarium-client`: HTTP and WebSocket client crate
- `crates/librarium-tauri`: desktop shell that embeds the frontend and server. Has a `[lib]` (`librarium_tauri_lib`) alongside its `[[bin]]` for the Android/iOS native-library entry point (#61); desktop-only setup (config/JWT/tray/deep-links/actix/health-poll, `sync_*` commands) is gated behind a default-on `desktop` Cargo feature
- `crates/librarium-mobile`: Route C thin-client command layer (vault list/get from a local JSON registry, file/directory ops over `librarium-core::FileService`, Markdown render, wiki-link/backlinks/outgoing-links, tags, frontmatter read/write, on-device Tantivy search, local metadata store — preferences/recent/favorites/bookmarks — in its own `mobile.db`, and a `librarium-sync` bridge — add/list/remove remotes, map/unmap vaults, start/stop/status, plus single-remote `pairing_set`/`pairing_get`/`pairing_clear` — resolving local vault ids via the same JSON registry instead of the desktop's `librarium.db`, and storing API keys in platform secure storage via a `SecretStore` trait rather than any plaintext file); no frontend or Tauri-app wiring yet
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
  cargo ndk -t aarch64-linux-android -P 21 build -p librarium-core -p librarium-sync -p librarium-mobile
  cargo ndk -t x86_64-linux-android -P 21 build -p librarium-core -p librarium-sync -p librarium-mobile
  ```
  To confirm no C-toolchain dependency (`openssl-sys`, `onig`) has crept back
  into these three crates:
  ```bash
  cargo tree -p librarium-core -p librarium-sync -p librarium-mobile --target aarch64-linux-android -i openssl-sys
  cargo tree -p librarium-core -p librarium-sync -p librarium-mobile --target aarch64-linux-android -i onig
  ```
  Both should error with "did not match any packages" (i.e. not found).
- `librarium-tauri` mobile dependency-graph check (#61): confirms the
  desktop-only setup (config loading, JWT persistence, the tray, deep links,
  the actix thread, health polling, `sync_*` commands) is fully excluded
  from a mobile-config build, without needing an actual Android target
  installed — `--no-default-features` disables the default-on `desktop`
  Cargo feature on the normal host triple:
  ```bash
  cargo build -p librarium-tauri --no-default-features
  cargo tree -p librarium-tauri --no-default-features -e normal | grep -E "librarium-server|actix-web"
  ```
  The `grep` should find nothing.
- Mobile contract test (#59): asserts every route in #56/#57's scope
  (vault/file/render/resolve-link/backlinks, search, tags, preferences,
  recent files, favorites, bookmarks, random/daily notes) produces
  structurally equivalent output from the real `librarium-server` HTTP routes
  and the `librarium-mobile` functions `localDispatcher.ts` calls into. Runs
  as its own CI gate (`contract-test`), separate from `cargo test --workspace`:
  ```bash
  cargo test -p librarium-mobile --test contract_test
  ```
  See `crates/librarium-mobile/tests/contract_test.rs`'s module doc for the
  normalized-field list (fields stripped before comparison, with
  justification per field) and design notes.
- Frontend static coverage check for the same issue: asserts every #56/#57
  `apiXxx` call in `frontend/src/api/client.ts` still resolves to a route in
  `localDispatcher.ts`'s table (no live-response comparison — that's the Rust
  suite's job):
  ```bash
  npm --prefix frontend test -- localDispatcherCoverage
  ```

## Config And Runtime Notes

- The server reads `config.toml` by default, or `LIBRARIUM_CONFIG` / `--config`.
- Auth, JWT, LDAP, OIDC, CORS, vault paths, and TLS are configured in `crates/librarium-server/src/config/mod.rs`.
- The committed root `config.toml` is development-oriented, not a production baseline.
- File and vault operations must preserve path-safety checks in `FileService`.
- Search indexing and watcher behavior are tightly coupled to vault file mutations; changes here should be verified with integration tests.

## Code Areas To Inspect Carefully

- Auth and session behavior: `crates/librarium-server/src/routes/auth.rs`, `middleware/auth.rs`, `routes/totp.rs`
- Filesystem mutation paths: `crates/librarium-core/src/file_service.rs` (re-exported as `librarium::services::file_service`)
- Search index consistency: `crates/librarium-core/src/search_service.rs` (re-exported as `librarium::services::search_service`)
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
