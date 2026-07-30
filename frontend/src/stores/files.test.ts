import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// files.ts imports far more than this from '@/api/client', but the archive-
// import guard under test (#58) only ever reaches `apiImportArchive` and the
// `finally` block's `loadTree` (-> `apiGetFileTree`) — nothing else needs a
// real implementation for these two cases.
vi.mock('@/api/client', () => ({
    apiGetFileTree: vi.fn(),
    apiImportArchive: vi.fn(),
    isLocalTransportActive: vi.fn(),
    ApiError: class ApiError extends Error {},
}));

import { apiGetFileTree, apiImportArchive, isLocalTransportActive } from '@/api/client';
import { useFilesStore } from './files';
import type { ImportCandidate } from '@/api/types';

function archiveCandidate(name = 'backup.zip'): ImportCandidate {
    return { file: new File(['x'], name), relativePath: name };
}

describe('useFilesStore.importCandidates archive gating (#58)', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        vi.mocked(apiGetFileTree).mockResolvedValue([]);
    });

    it('rejects an archive candidate under the local transport before calling apiImportArchive', async () => {
        vi.mocked(isLocalTransportActive).mockReturnValue(true);
        const store = useFilesStore();

        await expect(store.importCandidates('v1', [archiveCandidate()])).rejects.toThrow(/not available offline/i);

        expect(apiImportArchive).not.toHaveBeenCalled();
    });

    it('still calls apiImportArchive for an archive candidate under the HTTP transport', async () => {
        vi.mocked(isLocalTransportActive).mockReturnValue(false);
        vi.mocked(apiImportArchive).mockResolvedValue({ extracted: ['a.md'], count: 1, skipped: [], skipped_count: 0 });
        const store = useFilesStore();

        const result = await store.importCandidates('v1', [archiveCandidate()]);

        expect(apiImportArchive).toHaveBeenCalledOnce();
        expect(result.uploaded).toEqual([{ path: 'a.md', filename: 'a.md', size: 0 }]);
    });

    it('does not reject when there are no archive candidates, even under the local transport', async () => {
        vi.mocked(isLocalTransportActive).mockReturnValue(true);
        const store = useFilesStore();

        const result = await store.importCandidates('v1', []);

        expect(result).toEqual({ uploaded: [], skipped: [], directoryCount: 0, totalBytes: 0 });
        expect(apiImportArchive).not.toHaveBeenCalled();
    });
});
