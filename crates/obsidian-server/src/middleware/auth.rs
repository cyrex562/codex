use crate::config::AppConfig;
use actix_web::body::{EitherBody, MessageBody};
use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header,
    Error, HttpMessage, HttpResponse,
};
use futures::future::{ready, LocalBoxFuture, Ready};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct UserId(pub String);

pub struct AuthMiddleware;

impl<S, B> Transform<S, ServiceRequest> for AuthMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type InitError = ();
    type Transform = AuthMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AuthMiddlewareService { service }))
    }
}

pub struct AuthMiddlewareService<S> {
    service: S,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    sub: String,
    username: String,
    token_type: String,
    exp: i64,
    iat: i64,
}

impl<S, B> Service<ServiceRequest> for AuthMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let should_skip = should_skip_auth(&req);

        if should_skip {
            let fut = self.service.call(req);
            return Box::pin(async move { Ok(fut.await?.map_into_left_body()) });
        }

        let app_cfg = req
            .app_data::<actix_web::web::Data<AppConfig>>()
            .map(|cfg| cfg.get_ref().clone())
            .unwrap_or_default();

        if !app_cfg.auth.enabled {
            let fut = self.service.call(req);
            return Box::pin(async move { Ok(fut.await?.map_into_left_body()) });
        }

        let bearer = match extract_bearer(req.headers().get(header::AUTHORIZATION)) {
            Some(token) => token,
            None => {
                let response = HttpResponse::Unauthorized().json(serde_json::json!({
                    "error": "UNAUTHORIZED",
                    "message": "Missing or invalid Authorization header"
                }));
                return Box::pin(
                    async move { Ok(req.into_response(response).map_into_right_body()) },
                );
            }
        };

        let secret = effective_jwt_secret(&app_cfg);
        let claims = match decode::<Claims>(
            bearer,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::default(),
        ) {
            Ok(data) => data.claims,
            Err(_) => {
                let response = HttpResponse::Unauthorized().json(serde_json::json!({
                    "error": "UNAUTHORIZED",
                    "message": "Invalid or expired token"
                }));
                return Box::pin(
                    async move { Ok(req.into_response(response).map_into_right_body()) },
                );
            }
        };

        if claims.token_type != "access" {
            let response = HttpResponse::Unauthorized().json(serde_json::json!({
                "error": "UNAUTHORIZED",
                "message": "Access token required"
            }));
            return Box::pin(async move { Ok(req.into_response(response).map_into_right_body()) });
        }

        req.extensions_mut().insert(UserId(claims.sub));
        let fut = self.service.call(req);
        Box::pin(async move { Ok(fut.await?.map_into_left_body()) })
    }
}

fn should_skip_auth(req: &ServiceRequest) -> bool {
    let path = req.path();

    if path == "/" {
        return true;
    }

    if path.starts_with("/api/auth/") {
        return true;
    }

    if !path.starts_with("/api") && has_static_extension(path) {
        return true;
    }

    false
}

fn has_static_extension(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".html", ".js", ".mjs", ".css", ".map", ".json", ".ico", ".svg", ".png", ".jpg", ".jpeg",
        ".gif", ".webp", ".woff", ".woff2", ".ttf", ".eot", ".txt",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn extract_bearer(auth_header: Option<&header::HeaderValue>) -> Option<&str> {
    let raw = auth_header?.to_str().ok()?;
    raw.strip_prefix("Bearer ")
}

fn effective_jwt_secret(app_cfg: &AppConfig) -> String {
    if app_cfg.auth.jwt_secret.trim().is_empty() {
        crate::config::DEFAULT_DEV_JWT_SECRET.to_string()
    } else {
        app_cfg.auth.jwt_secret.clone()
    }
}
