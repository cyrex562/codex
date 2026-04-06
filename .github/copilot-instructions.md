# Copilot Instructions for Obsidian Host

A self-hosted web UI for Obsidian vaults built with Rust (backend) and Vue.js/TypeScript (frontend).

## Build, Test, and Lint Commands

### Backend (Rust)

**Build:**
```bash
cargo build --release
```

**Test:**
```bash
# All tests (unit + integration)
cargo test

# Single integration test file
cargo test --test conflict_tests

# Single test by name
cargo test test_name

# With output logging
RUST_LOG=debug cargo test -- --nocapture
```

**Lint:**
```bash
cargo fmt              # Format code
cargo clippy           # Lint checks
```

**Benchmarks:**
```bash
cargo bench
```

### Frontend (Vue.js/TypeScript)

**Build:**
```bash
cd frontend
npm install
npm run build          # Production build
npm run build:watch    # Watch mode
```

**Development:**
```bash
npm run dev            # Vite dev server
```

**Test:**
```bash
npm test              # Run unit tests (Vitest)
npm run test:watch    # Watch mode
npm run test:e2e      # Playwright E2E tests
```

### Full Development Setup

Run these in separate terminals:

```bash
# Terminal 1: Frontend dev server
cd frontend
npm run dev

# Terminal 2: Backend server
cargo run
```

Then open http://localhost:8080

## Architecture Overview

### Workspace Structure

This is a **Cargo workspace** with 4 crates:

- `crates/obsidian-server/` - Main backend server (default member)
- `crates/obsidian-types/` - Shared types/models
- `crates/obsidian-client/` - Client SDK library (HTTP + WebSocket API wrapper)
- `crates/obsidian-desktop/` - Native desktop client (Iced GUI)

**Validate desktop crate:** `cargo check -p obsidian-desktop`

### Desktop Client

The native desktop client (`obsidian-desktop`) is a standalone GUI application built with **Iced** (Rust GUI framework). It connects to the Obsidian Host server via the `obsidian-client` library.

**Architecture:**
- **UI Framework:** Iced (immediate-mode GUI with Elm architecture)
- **API Communication:** Uses `obsidian-client` for HTTP REST API calls
- **Real-time Sync:** WebSocket connection for file change notifications
- **State Management:** `state.rs` contains app state and business logic
- **UI Rendering:** `ui.rs` contains view components

**Key features:**
- Vault browsing and file operations (CRUD)
- Markdown editor with multiple modes (raw/formatted/preview)
- Frontmatter editing with JSON validation
- Full-text search and quick switcher
- WebSocket sync with automatic reconnection
- Local session persistence (restores tabs/vault on restart)
- Template insertion with variable substitution
- Conflict resolution UI
- Plugin manager panel
- Preferences sync with server

**Run desktop client:**
```bash
cargo run -p obsidian-desktop
```

**Build desktop client:**
```bash
cargo build --release -p obsidian-desktop
```

**Desktop logging:** Set `RUST_LOG=obsidian_desktop=debug` for verbose output.

**Important:** The desktop client is a **server client** - it requires a running Obsidian Host server (web or self-hosted) to connect to. Configure the server URL in the login screen.

### Desktop-Server Synchronization

The desktop client uses a **partial sync** model for performance and offline support:

**What syncs immediately:**
- **File tree metadata** - Directory structure and file names loaded on vault selection
- **WebSocket events** - Real-time notifications of file changes (create, modify, delete, rename)
- **Active file content** - Only when user opens a file for viewing/editing

**Lazy loading pattern:**
- Desktop does NOT download all vault content on startup
- File content fetched on-demand via `GET /api/vaults/{id}/files/{path}` when opened
- Large file uploads use chunked transfer via upload sessions (`create_upload_session` → `upload_chunk` → `finish_upload_session`)

**Local caching (`state.rs`):**
- **Cache location:** `~/.config/obsidian-host/file-cache/{vault_id}/` (Linux/macOS) or `%APPDATA%\obsidian-host\file-cache\{vault_id}\` (Windows)
- **What's cached:** File content of opened files (flat structure with `__` path separators)
- **Offline edits:** Queued in `__edit_queue__/` subdirectory with timestamp prefixes
- **Replay on reconnect:** `drain_offline_edits()` replays queued edits when connection restored

**WebSocket sync flow:**
1. Desktop connects to `GET /api/ws` and maintains persistent connection
2. Server broadcasts `WsMessage` events for file changes
3. Desktop updates local state (file tree, open tabs) without re-fetching
4. If edited file changes server-side, conflict detection triggers

**Key functions:**
- `cache_file(vault_id, path, content)` - Cache file locally
- `read_cached_file(vault_id, path)` - Read from cache (returns `Option<String>`)
- `enqueue_offline_edit(vault_id, path, content)` - Queue edit for later sync
- `drain_offline_edits(vault_id)` - Retrieve and clear queued edits

**Limitations:**
- No ETag-based conflict detection yet (planned)
- No delta sync for large files (sends full content)
- Rename events may lose old path info (server limitation)
- No automatic background sync service

See `docs/PLAN-desktop-sync-multiuser.md` for planned improvements.

### Backend Architecture

Built with **Actix Web** (Rust web framework) + **SQLite** for metadata.

**Key components:**

1. **FileService** (`services/file_service.rs`)
   - All filesystem I/O operations
   - **Security:** Uses `canonicalize` for path traversal prevention
   - Delete operations move files to `.trash` (soft delete)

2. **SearchIndex** (`services/search_service.rs`)
   - In-memory inverted index for full-text search
   - Rebuilt on startup, updated incrementally via file events
   - Indexes markdown content across all vaults

3. **FileWatcher** (`watcher/`)
   - Uses `notify` crate for cross-platform filesystem monitoring
   - Runs in separate thread with debouncing
   - Broadcasts events via Tokio broadcast channel

4. **WebSocketHandler** (`routes/ws.rs`)
   - Subscribes to file event broadcasts
   - Pushes real-time updates to connected clients
   - Triggers UI refreshes (file tree, content reload)

**Data flow:**
1. User edits → `PUT /api/vaults/{id}/files/{path}`
2. FileService writes to disk
3. FileWatcher detects change
4. SearchIndex updated + WebSocket broadcast
5. Frontend receives event → UI updates

### Frontend Architecture

Built with **Vue 3** + **TypeScript** + **Vuetify** + **Vite**.

**Key directories:**
- `frontend/src/pages/` - Route components
- `frontend/src/components/` - Reusable Vue components
- `frontend/src/stores/` - Pinia state management
- `frontend/src/editor/` - Editor integrations (TipTap, CodeJar)
- `frontend/src/api/` - API client wrappers

**Editor modes:**
- Raw markdown (CodeJar)
- WYSIWYG (TipTap)
- Split view (side-by-side)
- Preview only

### Database

SQLite stores:
- `vaults` - Registered vault paths
- `preferences` - User settings (theme, editor mode, etc.)
- `recent_files` - File history

**Migrations:** Managed via SQLx (see `crates/obsidian-server/src/db/migrations/`)

## Conventions

### Rust Code

- **Follow `rustfmt` and `clippy` standards** - Run before committing
- **Error handling:** Use `anyhow::Result` for most functions, `thiserror` for custom errors
- **Logging:** Use `tracing` macros (`info!`, `debug!`, `warn!`, `error!`)
- **Configuration:** Environment vars override `config.toml` using double underscores (e.g., `OBSIDIAN__SERVER__PORT`)

### Frontend Code

- **TypeScript strict mode** - All code must be typed
- **Component naming:** PascalCase for `.vue` files
- **API calls:** Use wrappers in `frontend/src/api/` (don't call fetch directly)
- **State management:** Use Pinia stores for shared state

### Security

- **Path traversal protection:** All file paths must go through `FileService::canonicalize_path`
- **Never trust user input:** Validate vault IDs and file paths in route handlers
- **Soft deletes:** Move to `.trash/` instead of permanent deletion

### Testing

- **Integration tests:** Located in `tests/` directory (not in `src/`)
- **Unit tests:** Inline `#[cfg(test)] mod tests` in source files
- **Test helpers:** Use `tempfile::TempDir` for filesystem tests
- **Frontend tests:** Unit tests with Vitest, E2E with Playwright

## Configuration

Configuration is loaded from (in priority order):
1. Environment variables (`OBSIDIAN__*`)
2. `config.toml` file
3. Defaults

**Key settings:**
- `server.host` / `server.port` - Binding address
- `database.path` - SQLite database location
- `vault.index_exclusions` - Folders to skip during indexing (default: `.git`, `.obsidian`, `.trash`, `node_modules`)
- `auth.enabled` - Toggle authentication (default: `false`)
- `storage.backend` - `local` (implemented) or `s3` (scaffolded)

**Logging:** Set `RUST_LOG=debug` for verbose output, `LOG_FORMAT=json` for structured logs.

## Frontend Asset Embedding

Frontend assets are **embedded into the binary** at compile time using `rust-embed`:
1. `npm run build` generates files in `frontend/dist/`
2. `cargo build --release` embeds `frontend/dist/` into binary
3. No need to copy frontend files separately - binary is standalone

**Important:** Always build frontend before backend for release builds.

## Release Profile Optimizations

The workspace uses aggressive release optimizations (see `Cargo.toml`):
- `opt-level = "z"` - Optimize for binary size
- `lto = true` - Link-time optimization
- `strip = true` - Remove debug symbols
- `panic = "abort"` - Remove unwinding code

Expect longer compile times in release mode.

## Cross-Platform Considerations

- **File paths:** Use `std::path::Path` methods (not string manipulation)
- **Line endings:** Markdown files may have CRLF or LF - normalize when needed
- **Case sensitivity:** Filesystem may be case-insensitive (Windows/macOS) or case-sensitive (Linux)
- **File watching:** `notify` crate handles cross-platform differences

## API Endpoints

Key routes (see `docs/API.md` for full reference):

- `GET /api/vaults` - List registered vaults
- `POST /api/vaults` - Register new vault
- `GET /api/vaults/{id}/files` - Get file tree
- `GET /api/vaults/{id}/files/{path}` - Read file content
- `PUT /api/vaults/{id}/files/{path}` - Update file
- `DELETE /api/vaults/{id}/files/{path}` - Soft delete (move to `.trash`)
- `GET /api/vaults/{id}/search?q={query}` - Full-text search
- `GET /api/ws` - WebSocket connection for real-time updates

## Deployment

**Docker:**
```bash
docker-compose up
```

**Manual (with embedded frontend):**
```bash
cd frontend && npm run build && cd ..
cargo build --release
./target/release/obsidian-host
```

**Cross-compilation:**
```bash
cargo install cross
cross build --target x86_64-unknown-linux-gnu --release
```

See `docs/DOCKER.md` and `docs/BUILD.md` for details.
