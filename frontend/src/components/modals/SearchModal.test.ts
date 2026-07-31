import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { vuetify } from '@/plugins/vuetify';

vi.mock('@/api/client', () => ({
    apiSearch: vi.fn(),
}));

import { apiSearch } from '@/api/client';
import { LocalSearchUnavailableError } from '@/api/localDispatcher';
import { useVaultsStore } from '@/stores/vaults';
import SearchModal from './SearchModal.vue';

let mounted: ReturnType<typeof mount> | null = null;

function mountModal() {
    const wrapper = mount(SearchModal, {
        props: { modelValue: false },
        global: { plugins: [vuetify] },
    });
    mounted = wrapper;
    useVaultsStore().activeVaultId = 'v1';
    return wrapper;
}

describe('SearchModal', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    afterEach(() => {
        // `v-dialog` teleports into `document.body`, which outlives the
        // wrapper unless explicitly unmounted — leaks across tests otherwise.
        mounted?.unmount();
        mounted = null;
    });

    it('shows a friendly empty state when the local index is unavailable', async () => {
        // Not `...Once`: setting `modelValue` and `initialQuery` together
        // fires both of SearchModal's watchers, so `search()` runs twice.
        vi.mocked(apiSearch).mockRejectedValue(new LocalSearchUnavailableError('v1'));
        const wrapper = mountModal();

        await wrapper.setProps({ modelValue: true, initialQuery: 'todo' });
        await flushPromises();

        // `v-dialog` teleports its content to `document.body`, so it isn't
        // under `wrapper`'s own root element.
        expect(document.body.textContent).toContain("isn't available offline");
        expect(document.body.textContent).not.toContain('No results found.');
    });

    it('shows "No results found" for a real empty result, not the offline message', async () => {
        vi.mocked(apiSearch).mockResolvedValue({ results: [], total: 0, page: 1, page_size: 50 } as any);
        const wrapper = mountModal();

        await wrapper.setProps({ modelValue: true, initialQuery: 'todo' });
        await flushPromises();

        expect(document.body.textContent).toContain('No results found.');
        expect(document.body.textContent).not.toContain("isn't available offline");
    });
});
