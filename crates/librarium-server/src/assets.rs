use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../target/frontend/"]
pub struct Assets;

// Ties this crate's compilation to the built frontend's contents. build.rs
// derives FRONTEND_STAMP from the files under target/frontend/, so whenever the
// SPA is rebuilt this constant changes, forcing rustc to re-expand the RustEmbed
// derive above and re-embed the fresh assets. Without this, a release build can
// silently ship a stale UI after a frontend-only change. Referenced (not just
// defined) so the dependency is real and can't be optimized away.
const _FRONTEND_STAMP: &str = env!("FRONTEND_STAMP");

/// Returns the compile-time frontend content stamp. Exposed so it's a genuine
/// use of the embedded env var, keeping the rebuild dependency load-bearing.
pub fn frontend_stamp() -> &'static str {
    _FRONTEND_STAMP
}
