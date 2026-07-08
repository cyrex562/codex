/**
 * Pane visibility selection for PaneContainer.
 *
 * Desktop shows every pane (split view). Mobile shows only the ACTIVE pane —
 * split panes don't fit on a phone — while preserving the split state so
 * widening the viewport brings the other panes back untouched.
 *
 * Pure function so the policy is unit-testable without mounting Vuetify.
 */
export function selectVisiblePanes<T extends { id: string }>(
  panes: T[],
  activePaneId: string | null,
  isMobile: boolean,
): T[] {
  if (!isMobile) return panes;
  const active = panes.find((p) => p.id === activePaneId);
  return active ? [active] : panes.slice(0, 1);
}
