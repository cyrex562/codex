import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { vuetify } from '@/plugins/vuetify';
import { useSyncStore } from '@/stores/sync';
import { useVaultsStore } from '@/stores/vaults';
import type { SyncVaultStatus } from '@/utils/tauri';
import SyncStatusPanel from './SyncStatusPanel.vue';

function status(overrides: Partial<SyncVaultStatus> = {}): SyncVaultStatus {
    return {
        remote_id: 'primary',
        local_vault_id: 'v1',
        state: 'live',
        last_synced_seq: 1,
        pending_outbox: 0,
        last_error: null,
        synced: 0,
        total: 0,
        ...overrides,
    };
}

function mountPanel() {
    return mount(SyncStatusPanel, { global: { plugins: [vuetify] } });
}

describe('SyncStatusPanel', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('shows an empty-state message when no vaults are mapped', () => {
        const wrapper = mountPanel();
        expect(wrapper.text()).toContain('No vaults are mapped to a sync remote yet.');
    });

    it.each(['offline', 'connecting', 'syncing', 'catching_up', 'live'] as const)(
        'renders the %s state with its label',
        (state) => {
            const syncStore = useSyncStore();
            syncStore.statuses = [status({ state })];
            const wrapper = mountPanel();

            expect(wrapper.find('[data-testid="sync-status-row"]').exists()).toBe(true);
            expect(wrapper.find('[data-testid="sync-status-chip"]').text().length).toBeGreaterThan(0);
        },
    );

    it('shows a progress bar with the synced/total ratio while syncing', () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status({ state: 'syncing', synced: 25, total: 100 })];
        const wrapper = mountPanel();

        const progress = wrapper.find('[data-testid="sync-status-progress"]');
        expect(progress.exists()).toBe(true);
        expect(wrapper.text()).toContain('25 / 100 files');
    });

    it('does not show a progress bar for non-syncing states', () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status({ state: 'live' })];
        const wrapper = mountPanel();

        expect(wrapper.find('[data-testid="sync-status-progress"]').exists()).toBe(false);
    });

    it('shows the pending outbox count when nonzero', () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status({ pending_outbox: 3 })];
        const wrapper = mountPanel();

        expect(wrapper.text()).toContain('3 pending');
    });

    it('shows the last error message when present', () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status({ last_error: 'connection refused' })];
        const wrapper = mountPanel();

        expect(wrapper.text()).toContain('connection refused');
    });

    it('shows the vault name from the vaults store instead of the raw id', () => {
        const syncStore = useSyncStore();
        const vaultsStore = useVaultsStore();
        vaultsStore.vaults = [{ id: 'v1', name: 'My Vault' } as any];
        syncStore.statuses = [status()];
        const wrapper = mountPanel();

        expect(wrapper.text()).toContain('My Vault');
    });
});
