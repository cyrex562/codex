import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { vuetify } from '@/plugins/vuetify';

vi.mock('@/utils/tauri', () => ({
    mobileFileTree: vi.fn(),
    mobileFileDelete: vi.fn(),
    mobileFileRename: vi.fn(),
}));

import { mobileFileTree, mobileFileDelete, mobileFileRename } from '@/utils/tauri';
import type { SyncVaultStatus } from '@/utils/tauri';
import { useSyncStore } from '@/stores/sync';
import { useTabsStore } from '@/stores/tabs';
import ConflictsPanel from './ConflictsPanel.vue';

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
    return mount(ConflictsPanel, { global: { plugins: [vuetify] } });
}

describe('ConflictsPanel', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        vi.mocked(mobileFileTree).mockResolvedValue([]);
    });

    it('shows an empty-state message when there are no conflicts', async () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status()];
        const wrapper = mountPanel();
        await flushPromises();

        expect(wrapper.text()).toContain('No conflicts.');
    });

    it('scans every mapped vault on mount and lists conflict_* files found', async () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status({ local_vault_id: 'v1' }), status({ local_vault_id: 'v2' })];
        vi.mocked(mobileFileTree).mockImplementation(async (vaultId: string) =>
            vaultId === 'v1'
                ? [{ name: 'conflict_todo_20260730_120000.md', path: 'conflict_todo_20260730_120000.md', is_directory: false }]
                : [],
        );

        const wrapper = mountPanel();
        await flushPromises();

        expect(mobileFileTree).toHaveBeenCalledWith('v1');
        expect(mobileFileTree).toHaveBeenCalledWith('v2');
        expect(wrapper.findAll('[data-testid="conflict-row"]')).toHaveLength(1);
        expect(wrapper.text()).toContain('conflict_todo_20260730_120000.md');
    });

    it('"Discard this version" deletes the conflict file and refreshes', async () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status()];
        vi.mocked(mobileFileTree).mockResolvedValue([
            { name: 'conflict_todo_20260730_120000.md', path: 'conflict_todo_20260730_120000.md', is_directory: false },
        ]);
        vi.mocked(mobileFileDelete).mockResolvedValue(undefined);

        const wrapper = mountPanel();
        await flushPromises();

        vi.mocked(mobileFileTree).mockResolvedValue([]);
        await wrapper.find('[data-testid="conflict-discard-btn"]').trigger('click');
        await flushPromises();

        expect(mobileFileDelete).toHaveBeenCalledWith('v1', 'conflict_todo_20260730_120000.md');
        expect(wrapper.findAll('[data-testid="conflict-row"]')).toHaveLength(0);
    });

    it('"Keep this version" deletes the original and renames the conflict onto it', async () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status()];
        vi.mocked(mobileFileTree).mockResolvedValue([
            { name: 'conflict_todo_20260730_120000.md', path: 'conflict_todo_20260730_120000.md', is_directory: false },
        ]);
        vi.mocked(mobileFileDelete).mockResolvedValue(undefined);
        vi.mocked(mobileFileRename).mockResolvedValue({ from: '', to: '', new_path: '' });

        const wrapper = mountPanel();
        await flushPromises();

        await wrapper.find('[data-testid="conflict-keep-btn"]').trigger('click');
        await flushPromises();

        expect(mobileFileDelete).toHaveBeenCalledWith('v1', 'todo.md');
        expect(mobileFileRename).toHaveBeenCalledWith('v1', 'conflict_todo_20260730_120000.md', 'todo.md');
    });

    it('"Open" opens the conflict file as a tab in the active pane', async () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status()];
        vi.mocked(mobileFileTree).mockResolvedValue([
            { name: 'conflict_todo_20260730_120000.md', path: 'conflict_todo_20260730_120000.md', is_directory: false },
        ]);

        const wrapper = mountPanel();
        await flushPromises();
        const tabsStore = useTabsStore();

        await wrapper.find('[data-testid="conflict-open-btn"]').trigger('click');

        expect([...tabsStore.tabs.values()].some((t) => t.filePath === 'conflict_todo_20260730_120000.md')).toBe(true);
    });

    it('disables Compare and Keep when the filename does not match the conflict convention', async () => {
        const syncStore = useSyncStore();
        syncStore.statuses = [status()];
        vi.mocked(mobileFileTree).mockResolvedValue([
            { name: 'conflict_weird_name.md', path: 'conflict_weird_name.md', is_directory: false },
        ]);

        const wrapper = mountPanel();
        await flushPromises();

        expect(wrapper.find('[data-testid="conflict-compare-btn"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-testid="conflict-keep-btn"]').attributes('disabled')).toBeDefined();
    });
});
