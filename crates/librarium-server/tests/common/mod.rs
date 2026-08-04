//! Shared helpers for the integration test binaries.
//!
//! Each file under `tests/` compiles to its own crate, so anything used by more
//! than one of them lives here and is pulled in with `mod common;`. Not every
//! consumer uses every helper (e.g. a file that only needs
//! `test_app_with_config` doesn't call the plain `test_app`), which reads as
//! dead code to a per-binary lint pass — hence the blanket allow, standard for
//! a shared test-utility module like this one.
#![allow(dead_code)]

use actix_web::body::MessageBody;
use actix_web::dev::{ServiceFactory, ServiceRequest, ServiceResponse};
use actix_web::middleware::{from_fn, Next};
use actix_web::{web, App, Error, HttpMessage};
use librarium::config::AppConfig;
use librarium::middleware::AuthenticatedUser;
use librarium::routes::AppState;

/// Stands in for `middleware::AuthMiddleware`, which the real server applies
/// app-wide (see `lib.rs`) and which is what normally puts an
/// `AuthenticatedUser` into request extensions.
///
/// Several handlers read that extension back through
/// `require_authenticated_user` and return 401 when it is absent, so a test app
/// assembled without any auth layer failed them for a reason unrelated to what
/// the test actually asserts. This supplies the extension and nothing else —
/// the handler-side auth checks stay exactly as they are, and the real server's
/// gating is unaffected.
async fn inject_test_user<B: MessageBody>(
    req: ServiceRequest,
    next: Next<B>,
) -> Result<ServiceResponse<B>, Error> {
    req.extensions_mut().insert(AuthenticatedUser {
        user_id: "test-user".to_string(),
        username: "tester".to_string(),
    });
    next.call(req).await
}

/// Builds a test app with `state`, the routes registered by `configure`, and an
/// authenticated user in scope. Route tests should go through here rather than
/// assembling `App::new()` themselves, so that an endpoint gaining an auth check
/// later doesn't silently turn into a blanket 401 across a whole suite.
///
/// Registers a default `AppConfig` alongside `state` — a no-op for tests that
/// never extract it, and enough for ones (like `/api/health`) that do without
/// needing every existing call site to start passing one explicitly. Tests
/// that care about specific config values (e.g. `auth.enabled`) should use
/// [`test_app_with_config`] instead.
pub fn test_app<F>(
    state: web::Data<AppState>,
    configure: F,
) -> App<
    impl ServiceFactory<
        ServiceRequest,
        Config = (),
        Response = ServiceResponse,
        Error = Error,
        InitError = (),
    >,
>
where
    F: FnOnce(&mut web::ServiceConfig),
{
    test_app_with_config(state, AppConfig::default(), configure)
}

/// Like [`test_app`], but with an explicit `AppConfig` instead of the default.
pub fn test_app_with_config<F>(
    state: web::Data<AppState>,
    config: AppConfig,
    configure: F,
) -> App<
    impl ServiceFactory<
        ServiceRequest,
        Config = (),
        Response = ServiceResponse,
        Error = Error,
        InitError = (),
    >,
>
where
    F: FnOnce(&mut web::ServiceConfig),
{
    App::new()
        .app_data(state)
        .app_data(web::Data::new(config))
        .wrap(from_fn(inject_test_user))
        .configure(configure)
}
