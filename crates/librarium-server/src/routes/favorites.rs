use crate::config::AppConfig;
use crate::error::{AppError, AppResult};
use crate::middleware::AuthenticatedUser;
use crate::routes::vaults::AppState;
use actix_web::{delete, get, post, web, HttpMessage, HttpRequest, HttpResponse};
use serde::Deserialize;

/// Extract the authenticated user id or return 401.
///
/// Favorites are strictly per-user, so unlike bookmarks we don't have a
/// meaningful "no user" fallback — if auth is disabled the routes still
/// require identity (a shared/anonymous favorites list would surprise users
/// who expect their star list to be private).
fn require_user_id(req: &HttpRequest, _config: &AppConfig) -> AppResult<String> {
    req.extensions()
        .get::<AuthenticatedUser>()
        .map(|u| u.user_id.clone())
        .ok_or_else(|| AppError::Unauthorized("Authentication required".to_string()))
}

#[derive(Debug, Deserialize)]
pub struct FavoritePathBody {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct FavoritePathQuery {
    pub path: String,
}

#[get("/api/vaults/{vault_id}/favorites")]
async fn list_favorites(
    state: web::Data<AppState>,
    config: web::Data<AppConfig>,
    vault_id: web::Path<String>,
    req: HttpRequest,
) -> AppResult<HttpResponse> {
    let user_id = require_user_id(&req, config.get_ref())?;
    let vault_id = vault_id.into_inner();
    state.db.get_vault(&vault_id).await?;
    let favorites = state.db.list_favorites(&user_id, &vault_id).await?;
    Ok(HttpResponse::Ok().json(favorites))
}

#[post("/api/vaults/{vault_id}/favorites")]
async fn add_favorite(
    state: web::Data<AppState>,
    config: web::Data<AppConfig>,
    vault_id: web::Path<String>,
    body: web::Json<FavoritePathBody>,
    req: HttpRequest,
) -> AppResult<HttpResponse> {
    let user_id = require_user_id(&req, config.get_ref())?;
    let vault_id = vault_id.into_inner();
    state.db.get_vault(&vault_id).await?;
    let favorite = state
        .db
        .add_favorite(&user_id, &vault_id, &body.path)
        .await?;
    Ok(HttpResponse::Created().json(favorite))
}

/// DELETE with `?path=...` query param. Path is a URL-encoded string; keeping
/// it in the query (rather than the route) avoids double-encoding slashes.
#[delete("/api/vaults/{vault_id}/favorites")]
async fn remove_favorite(
    state: web::Data<AppState>,
    config: web::Data<AppConfig>,
    vault_id: web::Path<String>,
    query: web::Query<FavoritePathQuery>,
    req: HttpRequest,
) -> AppResult<HttpResponse> {
    let user_id = require_user_id(&req, config.get_ref())?;
    let vault_id = vault_id.into_inner();
    state.db.get_vault(&vault_id).await?;
    state
        .db
        .remove_favorite(&user_id, &vault_id, &query.path)
        .await?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_favorites)
        .service(add_favorite)
        .service(remove_favorite);
}
