use crate::config::AppConfig;
use crate::error::{AppError, AppResult};
use crate::routes::vaults::AppState;
use actix_web::{post, web, HttpResponse};
use argon2::{password_hash::PasswordHash, Argon2, PasswordVerifier};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Serialize)]
pub struct LogoutResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    username: String,
    token_type: String,
    exp: i64,
    iat: i64,
}

#[post("/api/auth/login")]
async fn login(
    state: web::Data<AppState>,
    config: web::Data<AppConfig>,
    req: web::Json<LoginRequest>,
) -> AppResult<HttpResponse> {
    let username = req.username.trim();
    let password = req.password.trim();

    if username.is_empty() || password.is_empty() {
        return Err(AppError::InvalidInput(
            "Username and password are required".to_string(),
        ));
    }

    let user = state
        .db
        .get_user_auth_by_username(username)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid username or password".to_string()))?;

    let parsed_hash = PasswordHash::new(&user.2)
        .map_err(|_| AppError::Unauthorized("Invalid username or password".to_string()))?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Unauthorized("Invalid username or password".to_string()))?;

    let response = issue_tokens(&user.0, &user.1, &config.auth)?;
    Ok(HttpResponse::Ok().json(response))
}

#[post("/api/auth/refresh")]
async fn refresh_access_token(
    config: web::Data<AppConfig>,
    req: web::Json<RefreshRequest>,
) -> AppResult<HttpResponse> {
    let claims = decode_token(&req.refresh_token, &config.auth.jwt_secret)?;

    if claims.token_type != "refresh" {
        return Err(AppError::Unauthorized("Invalid refresh token".to_string()));
    }

    let response = issue_tokens(&claims.sub, &claims.username, &config.auth)?;
    Ok(HttpResponse::Ok().json(response))
}

#[post("/api/auth/logout")]
async fn logout() -> AppResult<HttpResponse> {
    // Short-lived JWT strategy for now (no server-side token revocation table yet).
    Ok(HttpResponse::Ok().json(LogoutResponse { success: true }))
}

fn issue_tokens(
    user_id: &str,
    username: &str,
    auth_cfg: &crate::config::AuthConfig,
) -> AppResult<LoginResponse> {
    let secret = effective_jwt_secret(auth_cfg);
    let now = Utc::now().timestamp();

    let access_claims = Claims {
        sub: user_id.to_string(),
        username: username.to_string(),
        token_type: "access".to_string(),
        iat: now,
        exp: now + auth_cfg.access_token_ttl as i64,
    };

    let refresh_claims = Claims {
        sub: user_id.to_string(),
        username: username.to_string(),
        token_type: "refresh".to_string(),
        iat: now,
        exp: now + auth_cfg.refresh_token_ttl as i64,
    };

    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to issue access token: {e}")))?;

    let refresh_jwt = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to issue refresh token: {e}")))?;

    Ok(LoginResponse {
        access_token,
        refresh_token: refresh_jwt,
        expires_in: auth_cfg.access_token_ttl,
    })
}

fn decode_token(token: &str, jwt_secret: &str) -> AppResult<Claims> {
    let secret = if jwt_secret.trim().is_empty() {
        crate::config::DEFAULT_DEV_JWT_SECRET.to_string()
    } else {
        jwt_secret.to_string()
    };

    let mut validation = Validation::default();
    validation.validate_exp = true;

    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized("Invalid or expired token".to_string()))?;

    Ok(data.claims)
}

fn effective_jwt_secret(auth_cfg: &crate::config::AuthConfig) -> String {
    if auth_cfg.jwt_secret.trim().is_empty() {
        crate::config::DEFAULT_DEV_JWT_SECRET.to_string()
    } else {
        auth_cfg.jwt_secret.clone()
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(login)
        .service(refresh_access_token)
        .service(logout);
}
