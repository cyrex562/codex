use crate::config::AuthConfig;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::auth::models::User;
use argon2::{password_hash::PasswordHash, Argon2, PasswordVerifier};

#[derive(Debug, Clone)]
pub struct AuthenticatedPrincipal {
    pub user_id: String,
    pub username: String,
    pub auth_method: String,
}

pub async fn authenticate_with_password(
    db: &Database,
    username: &str,
    password: &str,
) -> AppResult<AuthenticatedPrincipal> {
    let user_tuple = db
        .get_user_auth_by_username(username)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid username or password".to_string()))?;

    let parsed_hash = PasswordHash::new(&user_tuple.2)
        .map_err(|_| AppError::Unauthorized("Invalid username or password".to_string()))?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Unauthorized("Invalid username or password".to_string()))?;

    Ok(AuthenticatedPrincipal {
        user_id: user_tuple.0,
        username: user_tuple.1,
        auth_method: "password".to_string(),
    })
}
