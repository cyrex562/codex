use crate::config::AppConfig;
use crate::routes::vaults::AppState;
use actix_web::{get, web, HttpResponse};

/// Unauthenticated by design (`should_skip_auth` in `middleware/auth.rs`) —
/// callers need to reach this before any login has happened, including the
/// frontend's own decision of whether to require a login at all. `auth_enabled`
/// mirrors `AppConfig.auth.enabled` so the frontend can bypass the login
/// screen when the server enforces no auth, instead of getting stuck on a
/// login form that can never succeed (no admin is bootstrapped when auth is
/// disabled — see `lib.rs::run`'s bootstrap branch).
#[get("/api/health")]
async fn health(state: web::Data<AppState>, config: web::Data<AppConfig>) -> HttpResponse {
    // Quick DB connectivity check.
    let db_ok = state.db.user_count().await.is_ok();

    if db_ok {
        HttpResponse::Ok().json(serde_json::json!({
            "status": "healthy",
            "database": "connected",
            "auth_enabled": config.auth.enabled,
        }))
    } else {
        HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "status": "unhealthy",
            "database": "disconnected",
            "auth_enabled": config.auth.enabled,
        }))
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(health);
}
