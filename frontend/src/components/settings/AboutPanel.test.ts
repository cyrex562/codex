import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { vuetify } from '@/plugins/vuetify';

vi.mock('@/api/client', () => ({
    apiGetVersion: vi.fn(),
}));

import { apiGetVersion } from '@/api/client';
import AboutPanel from './AboutPanel.vue';

let mounted: ReturnType<typeof mount> | null = null;

describe('AboutPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        mounted?.unmount();
        mounted = null;
    });

    it('fetches and displays version, git hash, and build date on mount', async () => {
        vi.mocked(apiGetVersion).mockResolvedValue({
            version: '0.102.1',
            git_hash: 'abc1234',
            build_date: '2026-08-13',
        });

        mounted = mount(AboutPanel, { global: { plugins: [vuetify] } });
        await flushPromises();

        expect(apiGetVersion).toHaveBeenCalledTimes(1);
        expect(mounted.text()).toContain('0.102.1');
        expect(mounted.text()).toContain('abc1234');
        expect(mounted.text()).toContain('2026-08-13');
    });

    it('shows an error message when the version fetch fails', async () => {
        vi.mocked(apiGetVersion).mockRejectedValue(new Error('network down'));

        mounted = mount(AboutPanel, { global: { plugins: [vuetify] } });
        await flushPromises();

        expect(mounted.text()).toContain('network down');
    });

    it('copies the git hash to the clipboard', async () => {
        vi.mocked(apiGetVersion).mockResolvedValue({
            version: '0.102.1',
            git_hash: 'abc1234',
            build_date: '2026-08-13',
        });
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });

        mounted = mount(AboutPanel, { global: { plugins: [vuetify] } });
        await flushPromises();

        await mounted.find('button[title="Copy commit hash"]').trigger('click');
        await flushPromises();

        expect(writeText).toHaveBeenCalledWith('abc1234');
    });
});
