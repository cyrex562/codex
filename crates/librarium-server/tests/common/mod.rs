//! Shared helpers for the integration test binaries.
//!
//! Each file under `tests/` compiles to its own crate, so anything used by more
//! than one of them lives here and is pulled in with `mod common;`.

use actix_web::body::MessageBody;
use actix_web::dev::{ServiceFactory, ServiceRequest, ServiceResponse};
use actix_web::middleware::{from_fn, Next};
use actix_web::{web, App, Error, HttpMessage};
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
    App::new()
        .app_data(state)
        .wrap(from_fn(inject_test_user))
        .configure(configure)
}
