use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// User roles for authorization (OIDC branch)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    User,
    Pending,
    Suspended,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserRole::Admin => "admin",
            UserRole::User => "user",
            UserRole::Pending => "pending",
            UserRole::Suspended => "suspended",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "admin" => UserRole::Admin,
            "user" => UserRole::User,
            "suspended" => UserRole::Suspended,
            _ => UserRole::Pending,
        }
    }
}

/// Unified User representing BOTH password-based and OIDC users
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub role: UserRole,
    
    // OIDC explicit fields
    pub oidc_subject: Option<String>,
    pub oidc_issuer: Option<String>,
    
    // Password explicit fields
    pub is_admin: bool,
    pub must_change_password: bool,
    
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: String,
    pub username: String,
    
    // Made Option to support unified tables
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub role: Option<String>,
    pub oidc_subject: Option<String>,
    pub oidc_issuer: Option<String>,
    
    pub is_admin: i64,
    pub must_change_password: i64,
    
    pub created_at: String,
    pub updated_at: Option<String>,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        let is_admin = row.is_admin != 0;
        let role = row.role.map(|r| UserRole::from_str(&r)).unwrap_or_else(|| {
            if is_admin { UserRole::Admin } else { UserRole::Pending }
        });

        Self {
            id: row.id,
            username: row.username,
            email: row.email,
            name: row.name,
            picture: row.picture,
            role,
            oidc_subject: row.oidc_subject,
            oidc_issuer: row.oidc_issuer,
            is_admin,
            must_change_password: row.must_change_password != 0,
            created_at: DateTime::parse_from_rfc3339(&row.created_at)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now),
            updated_at: row.updated_at.and_then(|r| DateTime::parse_from_rfc3339(&r).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now),
        }
    }
}

/// A user session, stored server-side and referenced by cookie token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct SessionRow {
    pub id: String,
    pub user_id: String,
    pub token_hash: String,
    pub expires_at: String,
    pub created_at: String,
}

impl From<SessionRow> for Session {
    fn from(row: SessionRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            token_hash: row.token_hash,
            expires_at: DateTime::parse_from_rfc3339(&row.expires_at)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now),
            created_at: DateTime::parse_from_rfc3339(&row.created_at)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now),
        }
    }
}
