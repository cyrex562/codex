import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { vuetify } from '@/plugins/vuetify';

vi.mock('@/api/client', () => ({
    apiRenameFile: vi.fn(),
    apiGetFileTree: vi.fn(),
    apiGetPreferences: vi.fn(),
    apiUpdatePreferences: vi.fn(),
    isLocalTransportActive: vi.fn(() => false),
}));

import { apiRenameFile, apiGetFileTree, apiUpdatePreferences } from '@/api/client';
import { useVaultsStore } from '@/stores/vaults';
import DocumentMetaBar from './DocumentMetaBar.vue';

function mountBar(filePath = 'CDs to Buy 221ec5120f26804b9777e9a04d795d5f.md') {
    return mount(DocumentMetaBar, {
        props: { filePath, frontmatter: {}, isMd: true },
        global: { plugins: [vuetify] },
    });
}

describe('DocumentMetaBar rename', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        useVaultsStore().activeVaultId = 'v1';
        vi.mocked(apiGetFileTree).mockResolvedValue([]);
        vi.mocked(apiUpdatePreferences).mockImplementation(async (p) => p as never);
    });

    it('sends only one rename request when Enter and the resulting blur both fire', async () => {
        // Regression test for a real bug: the name field is wired to both
        // @keyup.enter and @blur so clicking away still commits an edit.
        // Pressing Enter used to hide the field (unmounting it) *before* the
        // rename request resolved — unmounting a focused input fires a
        // native blur, which re-entered commitName() a second time with the
        // same stale from/to paths while the first call's request was still
        // in flight. Whichever duplicate request landed second found the
        // source already renamed away and surfaced a spurious "Source not
        // found" error, even though the rename itself had already succeeded.
        let resolveRename!: (v: { new_path: string }) => void;
        vi.mocked(apiRenameFile).mockReturnValue(
            new Promise((resolve) => {
                resolveRename = resolve;
            }) as never,
        );

        const wrapper = mountBar();
        await wrapper.find('.doc-filename').trigger('click');
        const input = wrapper.find('input');
        await input.setValue('CDs to Buy.md');

        // Enter fires commitName(); it reaches its `await` on the
        // still-pending renameFile() call and suspends there.
        await input.trigger('keyup.enter');
        // Simulate the native blur that firing on the same (still-focused,
        // not-yet-actually-unmounted-in-jsdom) input would trigger once Vue
        // patches editingName=false out from under it — this is the second,
        // racing commitName() call the bug was about.
        await input.trigger('blur');

        expect(apiRenameFile).toHaveBeenCalledTimes(1);
        expect(apiRenameFile).toHaveBeenCalledWith(
            'v1',
            'CDs to Buy 221ec5120f26804b9777e9a04d795d5f.md',
            'CDs to Buy.md',
            'fail',
        );

        resolveRename({ new_path: 'CDs to Buy.md' });
        await flushPromises();

        // Still just the one call after the in-flight request resolves —
        // confirms the guard isn't merely delaying the duplicate.
        expect(apiRenameFile).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[type="error"]').exists()).toBe(false);
    });

    it('still commits a rename normally on a single Enter', async () => {
        vi.mocked(apiRenameFile).mockResolvedValue({ new_path: 'renamed.md' } as never);

        const wrapper = mountBar('old.md');
        await wrapper.find('.doc-filename').trigger('click');
        const input = wrapper.find('input');
        await input.setValue('renamed.md');
        await input.trigger('keyup.enter');
        await flushPromises();

        expect(apiRenameFile).toHaveBeenCalledTimes(1);
        expect(apiRenameFile).toHaveBeenCalledWith('v1', 'old.md', 'renamed.md', 'fail');
    });
});
