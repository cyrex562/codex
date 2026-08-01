import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { vuetify } from '@/plugins/vuetify';
import SyncStatusSection from './SyncStatusSection.vue';

const { isTauri, syncStatus, syncGetPolicy, syncSetPolicy, syncReconcileOnce } = vi.hoisted(() => ({
    isTauri: vi.fn(),
    syncStatus: vi.fn(),
    syncGetPolicy: vi.fn(),
    syncSetPolicy: vi.fn(),
    syncReconcileOnce: vi.fn(),
}));

vi.mock('@/utils/tauri', () => ({
    isTauri,
    syncStatus,
    syncStart: vi.fn(),
    syncStop: vi.fn(),
    syncUnmapVault: vi.fn(),
    syncGetPolicy,
    syncSetPolicy,
    syncReconcileOnce,
}));

function mountSection() {
    return mount(SyncStatusSection, { global: { plugins: [vuetify] } });
}

describe('SyncStatusSection (#64 sync policy)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isTauri.mockReturnValue(true);
        syncStatus.mockResolvedValue([]);
        syncGetPolicy.mockResolvedValue({ wifi_only: true, battery_threshold: 20 });
        syncSetPolicy.mockResolvedValue(undefined);
        syncReconcileOnce.mockResolvedValue(undefined);
    });

    it('shows the "only available in the desktop app" notice outside Tauri', () => {
        isTauri.mockReturnValue(false);
        const wrapper = mountSection();
        expect(wrapper.text()).toContain('only available in the desktop app');
    });

    it('loads and displays the stored policy on mount', async () => {
        syncGetPolicy.mockResolvedValue({ wifi_only: false, battery_threshold: 55 });
        const wrapper = mountSection();
        await flushPromises();

        expect(syncGetPolicy).toHaveBeenCalled();
        const numberInput = wrapper.find('input[type="number"]');
        expect((numberInput.element as HTMLInputElement).value).toBe('55');
    });

    it('saves the policy when the Wi-Fi-only switch is toggled', async () => {
        const wrapper = mountSection();
        await flushPromises();

        await wrapper.find('input[type="checkbox"]').setValue(false);
        await flushPromises();

        expect(syncSetPolicy).toHaveBeenCalledWith({ wifi_only: false, battery_threshold: 20 });
    });

    it('"Sync now" triggers a one-shot reconcile and refreshes status', async () => {
        const wrapper = mountSection();
        await flushPromises();
        syncStatus.mockClear();

        const buttons = wrapper.findAll('button');
        const syncNowBtn = buttons.find((b) => b.text().includes('Sync now'));
        expect(syncNowBtn).toBeTruthy();
        await syncNowBtn!.trigger('click');
        await flushPromises();

        expect(syncReconcileOnce).toHaveBeenCalled();
        expect(syncStatus).toHaveBeenCalled();
    });
});
