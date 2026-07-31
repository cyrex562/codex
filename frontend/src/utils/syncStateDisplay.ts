/**
 * Display helpers for `SyncVaultState` (see `@/utils/tauri`), shared by the
 * mobile-facing sync UI (`components/sync/*`). Deliberately separate from
 * `SyncStatusSection.vue`'s inline copy of the same mapping — that desktop
 * component is left untouched so this feature can't regress it.
 */
import type { SyncVaultState } from '@/utils/tauri';

export function stateColor(state: SyncVaultState): string {
  switch (state) {
    case 'live':
      return 'success';
    case 'syncing':
    case 'catching_up':
    case 'connecting':
      return 'warning';
    case 'offline':
    default:
      return 'default';
  }
}

export function stateLabel(state: SyncVaultState): string {
  switch (state) {
    case 'syncing':
      return 'Syncing';
    case 'catching_up':
      return 'Catching up';
    case 'connecting':
      return 'Connecting';
    case 'live':
      return 'Live';
    case 'offline':
    default:
      return 'Offline';
  }
}

export function stateIcon(state: SyncVaultState): string {
  switch (state) {
    case 'live':
      return 'mdi-check-circle-outline';
    case 'syncing':
    case 'catching_up':
      return 'mdi-sync';
    case 'connecting':
      return 'mdi-lan-pending';
    case 'offline':
    default:
      return 'mdi-cloud-off-outline';
  }
}

/**
 * Worst-first ranking for aggregating many `VaultStatus`es into one summary
 * (e.g. the TopBar chip): a lower number means "worse", so `Math.min` over
 * this picks the state that most needs the user's attention.
 */
const STATE_PRIORITY: Record<SyncVaultState, number> = {
  offline: 0,
  connecting: 1,
  syncing: 2,
  catching_up: 3,
  live: 4,
};

export function worstState(states: SyncVaultState[]): SyncVaultState | null {
  if (!states.length) return null;
  return states.reduce((worst, s) =>
    STATE_PRIORITY[s] < STATE_PRIORITY[worst] ? s : worst,
  );
}
