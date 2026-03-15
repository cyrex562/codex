
- do we need a config/preferences file?
- support python and wasm plugins
- explicitly back up to a cloud provider
- download from a cloud provider
- download from git
- publish to github
- sync with git
- preferences menu
- full text search
- file indexing
- create tui deployment tool that will re-deploy the server to the designated host on command
- re-write python plugin system -- hook events (frontend and backend), display html, js/ts, use config file in own dir.

- desktop client
  - standalone mode
  - cloud mode (connects to server API)
  - hybrid (leave files and oflders on server by default, click to download or download on open)

Foundation contracts (blocks both tracks)

Finalize ML API surface: outline generation, suggestion listing, dry-run apply, explicit apply.
Keep route/version patterns consistent with existing server APIs.
Backend platform work (depends on 1)

Add ML service + routes in server.
Add DB persistence for outlines/suggestions/apply receipts.
Reuse and extend current search primitives for ranking inputs.
Emit suggestion-availability events via existing realtime channel.
Track A — Native desktop (Iced) skeleton (depends on 2, parallel with Track B)

Add crates/obsidian-desktop and wire into workspace.
Use obsidian-client and obsidian-types for transport/types.
Build core shell: auth, vault tree, note open/edit/save, preview panel, event sync loop.
Track B — ML v1 feature set (depends on 2, parallel with Track A)

Outline endpoint: deterministic heading-based baseline + optional model-enhanced variant.
Organization suggestions endpoint: tags/categories/folder target + confidence + rationale.
Keep all changes non-destructive until explicit apply.
Client integration

Desktop: suggestion inbox + preview + accept/reject/apply + rollback UX.
Web (Vue): same ML panels and endpoint parity so both clients share backend contracts.
Hardening + release

Permissions, rate limits/timeouts, deterministic dry-run/apply behavior.
Release server/web ML behind feature flag first.
Release Iced desktop beta after core edit/sync + suggestion workflows are stable.