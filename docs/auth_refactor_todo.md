# Unified Authentication Refactoring TODO List

We are implementing a dual-authentication system supporting both traditional Password/JWT (`main` branch) and Session-based OIDC/Google Auth (`incoming` branch). The implementation relies on restructuring authentication strictly into `crates/obsidian-server/src/auth/`.

## Phase 1: Database & Models (The Foundation)
- [ ] **1. Merge Database Migrations (`crates/obsidian-server/src/db/mod.rs`)**
    - [ ] Update the `users` table schema to include OIDC fields (`oidc_subject`, `oidc_issuer`, `picture`).
    - [ ] Add the `sessions` table creation script for tracking logged-in OIDC users.
    - [ ] Add the `oidc_states` table for OAuth CSRF protection.
- [ ] **2. Merge Unified Models (`crates/obsidian-server/src/auth/models.rs`)**
    - [ ] Combine the `User` struct to represent a user created via either Provider.
    - [ ] Add `Session` struct definitions.
- [ ] **3. Update DB Access Methods**
    - [ ] Inject the new OIDC DB helper methods (`create_session`, `get_valid_session`, `store_oidc_state`, etc.) into `db/mod.rs`.

## Phase 2: Service Layer & Logic
- [ ] **4. Extract Password Service (`crates/obsidian-server/src/auth/jwt.rs`)**
    - [ ] Extract the password verification and JWT parsing from the global middleware.
- [ ] **5. Implement OIDC Service (`crates/obsidian-server/src/auth/oidc_service.rs`)**
    - [ ] Complete the migration of the Google SDK `AuthService` logic.
    - [ ] Verify `openidconnect` library usage.

## Phase 3: The Unified Middleware
- [ ] **6. Rewrite `AuthMiddleware` (`crates/obsidian-server/src/middleware/auth.rs`)**
    - [ ] Update the extractor to check the `obsidian_session` Cookie OR the `Authorization` Bearer Token automatically.
    - [ ] Ensure the resulting object is a standardized `AuthenticatedUser` (or `AdminUser`).

## Phase 4: Routes & Configuration Let's Hook it Up!
- [x] **7. Wire Up Authentication Routes (`crates/obsidian-server/src/auth/routes.rs`)**
    - [x] Password: `/api/auth/login`, `/api/auth/change-password`
    - [x] OIDC: `/api/auth/google`, `/api/auth/callback`
- [x] **8. Mount Routes in Server (`crates/obsidian-server/src/main.rs`)**
    - [x] Add dependencies (`openidconnect`, `sha2`, `hex`) to `crates/obsidian-server/Cargo.toml`.
    - [x] Merge the `[auth]` settings in `config.toml` to support `google_client_id` alongside `jwt_secret`.
    - [x] Register the new Unified Auth configuration in the `HttpServer`.
