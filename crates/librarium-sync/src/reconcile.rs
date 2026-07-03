//! The pure three-way reconciliation core.
//!
//! Given the content hashes of a single path on three sides — the `base` (the
//! hash both sides agreed on at the last successful sync), the current `local`
//! hash, and the current `remote` hash — [`reconcile`] returns the [`Action`]
//! to take and the new base to record afterward. `None` means the file is
//! absent (never existed, or was deleted / tombstoned).
//!
//! This function is deliberately total and side-effect free so the entire
//! decision matrix can be exhaustively unit-tested without any I/O.

/// Which side wins the canonical path in a divergent conflict.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictWinner {
    /// The local copy stays at the canonical path.
    Local,
    /// The remote copy stays at the canonical path (server is the hub, so this
    /// is the default when both sides hold content).
    Remote,
}

/// The reconciliation outcome for one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Nothing to do; the base already matches both sides.
    Noop,
    /// Both sides already agree but the recorded base was stale — just advance
    /// the base, no file transfer.
    AdoptBase,
    /// Send the local content to the remote.
    PushUpsert,
    /// Delete the file on the remote.
    PushDelete,
    /// Write the remote content over the local file.
    PullUpsert,
    /// Delete the file locally.
    PullDelete,
    /// Both sides diverged. The `winner` keeps the canonical path; the loser's
    /// content (when it has any) is preserved in a conflict-named sibling and
    /// re-propagated so both machines converge without losing data.
    Conflict { winner: ConflictWinner },
}

/// The action to take plus the base hash to persist once it succeeds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub action: Action,
    pub new_base: Option<String>,
}

impl Decision {
    fn new(action: Action, new_base: Option<&str>) -> Self {
        Self {
            action,
            new_base: new_base.map(|s| s.to_string()),
        }
    }
}

/// Decide what to do for one path from the three content hashes.
///
/// See the module docs and the exhaustive tests below for the full matrix.
pub fn reconcile(base: Option<&str>, local: Option<&str>, remote: Option<&str>) -> Decision {
    // Sides already agree: either a true no-op, or the base needs to catch up.
    if local == remote {
        return if local == base {
            Decision::new(Action::Noop, base)
        } else {
            Decision::new(Action::AdoptBase, local)
        };
    }

    // Sides disagree, so at least one of them changed relative to the base
    // (if both equalled the base they would equal each other).
    let local_changed = local != base;
    let remote_changed = remote != base;

    match (local_changed, remote_changed) {
        // Only the local side moved.
        (true, false) => match local {
            Some(_) => Decision::new(Action::PushUpsert, local),
            None => Decision::new(Action::PushDelete, None),
        },
        // Only the remote side moved.
        (false, true) => match remote {
            Some(_) => Decision::new(Action::PullUpsert, remote),
            None => Decision::new(Action::PullDelete, None),
        },
        // Both moved, and to different states — a genuine conflict.
        (true, true) => {
            let (winner, new_base) = match (local, remote) {
                // Remote deleted but local still edited: the edit wins and is
                // resurrected on the server.
                (Some(l), None) => (ConflictWinner::Local, Some(l)),
                // Local deleted but remote still edited: the edit wins and is
                // pulled back locally.
                (None, Some(r)) => (ConflictWinner::Remote, Some(r)),
                // Both hold divergent content: the server copy is canonical.
                (Some(_), Some(r)) => (ConflictWinner::Remote, Some(r)),
                // Both None is impossible here (that means local == remote).
                (None, None) => unreachable!("local == remote handled above"),
            };
            Decision {
                action: Action::Conflict { winner },
                new_base: new_base.map(|s| s.to_string()),
            }
        }
        // Neither changed yet local != remote is impossible.
        (false, false) => unreachable!("local != remote implies a side changed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shorthands for readability in the table.
    const B: Option<&str> = Some("base");
    const L: Option<&str> = Some("local");
    const R: Option<&str> = Some("remote");
    const NONE: Option<&str> = None;

    fn dec(action: Action, new_base: Option<&str>) -> Decision {
        Decision::new(action, new_base)
    }

    #[test]
    fn row1_nothing_changed() {
        assert_eq!(reconcile(B, B, B), dec(Action::Noop, B));
    }

    #[test]
    fn row2_only_local_changed() {
        assert_eq!(reconcile(B, L, B), dec(Action::PushUpsert, L));
    }

    #[test]
    fn row3_only_remote_changed() {
        assert_eq!(reconcile(B, B, R), dec(Action::PullUpsert, R));
    }

    #[test]
    fn row4_both_changed_same() {
        // base -> both sides independently arrive at the same new content.
        let same = Some("converged");
        assert_eq!(reconcile(B, same, same), dec(Action::AdoptBase, same));
    }

    #[test]
    fn row5_both_changed_different() {
        assert_eq!(
            reconcile(B, L, R),
            dec(Action::Conflict { winner: ConflictWinner::Remote }, R)
        );
    }

    #[test]
    fn row6_remote_deleted_local_untouched() {
        assert_eq!(reconcile(B, B, NONE), dec(Action::PullDelete, NONE));
    }

    #[test]
    fn row7_local_deleted_remote_untouched() {
        assert_eq!(reconcile(B, NONE, B), dec(Action::PushDelete, NONE));
    }

    #[test]
    fn row8_both_deleted() {
        // Base present, both gone: converge the base to a tombstone, no transfer.
        assert_eq!(reconcile(B, NONE, NONE), dec(Action::AdoptBase, NONE));
    }

    #[test]
    fn row9_remote_delete_vs_local_edit() {
        // Local edited, remote deleted: edit wins and is pushed back.
        assert_eq!(
            reconcile(B, L, NONE),
            dec(Action::Conflict { winner: ConflictWinner::Local }, L)
        );
    }

    #[test]
    fn row10_local_delete_vs_remote_edit() {
        // Remote edited, local deleted: edit wins and is pulled locally.
        assert_eq!(
            reconcile(B, NONE, R),
            dec(Action::Conflict { winner: ConflictWinner::Remote }, R)
        );
    }

    #[test]
    fn row11_new_local_file() {
        assert_eq!(reconcile(NONE, L, NONE), dec(Action::PushUpsert, L));
    }

    #[test]
    fn row12_new_remote_file() {
        assert_eq!(reconcile(NONE, NONE, R), dec(Action::PullUpsert, R));
    }

    #[test]
    fn row13_both_created_identical() {
        let same = Some("same-new");
        assert_eq!(reconcile(NONE, same, same), dec(Action::AdoptBase, same));
    }

    #[test]
    fn row14_both_created_different() {
        assert_eq!(
            reconcile(NONE, L, R),
            dec(Action::Conflict { winner: ConflictWinner::Remote }, R)
        );
    }

    #[test]
    fn nothing_ever_existed_is_noop() {
        assert_eq!(reconcile(NONE, NONE, NONE), dec(Action::Noop, NONE));
    }

    /// The function must be total: no input triple panics, and a Noop/AdoptBase
    /// always leaves the two sides in agreement.
    #[test]
    fn total_over_small_alphabet() {
        let alphabet = [NONE, Some("a"), Some("b"), Some("c")];
        for &b in &alphabet {
            for &l in &alphabet {
                for &r in &alphabet {
                    let d = reconcile(b, l, r);
                    // When the decision is a no-transfer convergence, the new
                    // base must equal both already-equal sides.
                    if matches!(d.action, Action::Noop | Action::AdoptBase) {
                        assert_eq!(l, r, "no-transfer action requires sides to agree");
                        assert_eq!(d.new_base.as_deref(), l);
                    }
                }
            }
        }
    }
}
