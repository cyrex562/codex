import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/utils/tauri', () => ({
    isTauri: vi.fn(() => false),
    saveFileDialog: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { isTauri, saveFileDialog } from '@/utils/tauri';
import { useVaultsStore } from '@/stores/vaults';
import { useTabsStore } from '@/stores/tabs';
import { _resetForTests, getLogger } from '@/utils/logger';
import {
    buildFeedbackZip,
    captureStateSnapshot,
    saveFeedbackZip,
} from './useFeedback';

describe('useFeedback', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        _resetForTests();
        vi.mocked(isTauri).mockReturnValue(false);
    });

    describe('captureStateSnapshot', () => {
        it('captures the active vault, open tabs/panes, logs, and environment info', () => {
            const vaultsStore = useVaultsStore();
            vaultsStore.vaults = [{ id: 'v1', name: 'My Vault', path: '/vaults/v1' } as never];
            vaultsStore.activeVaultId = 'v1';

            const tabsStore = useTabsStore();
            tabsStore.openTab('pane-1', 'notes/a.md', 'a.md');

            const log = getLogger('test');
            log.info('something happened');

            const snapshot = captureStateSnapshot();

            expect(snapshot.view.activeVaultId).toBe('v1');
            expect(snapshot.view.activeVaultName).toBe('My Vault');
            expect(snapshot.view.panes[0].tabs).toEqual([
                expect.objectContaining({ filePath: 'notes/a.md', fileType: 'markdown' }),
            ]);
            expect(snapshot.logs).toHaveLength(1);
            expect(snapshot.logs[0].message).toBe('something happened');
            expect(snapshot.environment.runtime).toBe('browser');
            expect(typeof snapshot.environment.appVersion).toBe('string');
        });

        it('reports runtime as tauri when running inside the desktop shell', () => {
            vi.mocked(isTauri).mockReturnValue(true);
            const snapshot = captureStateSnapshot();
            expect(snapshot.environment.runtime).toBe('tauri');
        });

        it('reports a null active vault when nothing is open', () => {
            const snapshot = captureStateSnapshot();
            expect(snapshot.view.activeVaultId).toBeNull();
            expect(snapshot.view.activeVaultName).toBeNull();
        });
    });

    describe('buildFeedbackZip', () => {
        it('produces a zip blob containing message.txt and state.json', async () => {
            const zip = await buildFeedbackZip('it crashed', null);
            expect(zip).toBeInstanceOf(Blob);
            expect(zip.size).toBeGreaterThan(0);

            const JSZip = (await import('jszip')).default;
            const loaded = await JSZip.loadAsync(zip);
            expect(loaded.file('message.txt')).not.toBeNull();
            expect(loaded.file('state.json')).not.toBeNull();
            expect(loaded.file('screenshot.png')).toBeNull();
            expect(await loaded.file('message.txt')!.async('string')).toBe('it crashed');
        });

        it('includes screenshot.png when a screenshot blob is passed', async () => {
            const shot = new Blob(['fake-png-bytes'], { type: 'image/png' });
            const zip = await buildFeedbackZip('it crashed', shot);

            const JSZip = (await import('jszip')).default;
            const loaded = await JSZip.loadAsync(zip);
            expect(loaded.file('screenshot.png')).not.toBeNull();
        });
    });

    describe('saveFeedbackZip', () => {
        it('triggers a browser download when not running in Tauri', async () => {
            vi.mocked(isTauri).mockReturnValue(false);
            const clickSpy = vi.fn();
            const originalCreateElement = document.createElement.bind(document);
            vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
                const el = originalCreateElement(tag);
                if (tag === 'a') el.click = clickSpy;
                return el;
            });
            URL.createObjectURL = vi.fn(() => 'blob:fake-url');
            URL.revokeObjectURL = vi.fn();

            const result = await saveFeedbackZip(new Blob(['x']));

            expect(result.saved).toBe(true);
            expect(result.path).toBeUndefined();
            expect(clickSpy).toHaveBeenCalled();
        });

        it('returns saved:false when the user cancels the desktop save dialog', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(saveFileDialog).mockResolvedValue(null);

            const result = await saveFeedbackZip(new Blob(['x']));

            expect(result.saved).toBe(false);
        });

        it('writes base64-encoded bytes via the write_binary_file command on desktop', async () => {
            vi.mocked(isTauri).mockReturnValue(true);
            vi.mocked(saveFileDialog).mockResolvedValue('/home/user/feedback.zip');
            const { invoke } = await import('@tauri-apps/api/core');

            const result = await saveFeedbackZip(new Blob(['hello']));

            expect(result).toEqual({ saved: true, path: '/home/user/feedback.zip' });
            expect(invoke).toHaveBeenCalledWith('write_binary_file', {
                path: '/home/user/feedback.zip',
                dataBase64: expect.any(String),
            });
        });
    });
});
