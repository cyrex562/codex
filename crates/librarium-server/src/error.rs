//! `AppError`/`AppResult` moved to `librarium-core` (LIB Route-C-01) so it can
//! be shared with a future thin mobile client with no actix/sqlx dependency.
//! Re-exported here so every existing `crate::error::…` path in this crate is
//! unaffected.
pub use librarium_core::error::*;
