import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
    isLocalTransportActive: vi.fn(),
}));

import { isLocalTransportActive } from '@/api/client';
import { useCapabilities } from './useCapabilities';

describe('useCapabilities (#58)', () => {
    it('grants every server-only capability under the HTTP transport', () => {
        vi.mocked(isLocalTransportActive).mockReturnValue(false);

        const capabilities = useCapabilities();

        expect(capabilities.isLocalMode).toBe(false);
        expect(capabilities.canUseAdmin).toBe(true);
        expect(capabilities.canUseGroupsAndSharing).toBe(true);
        expect(capabilities.canUsePlugins).toBe(true);
        expect(capabilities.canUseMlOrganize).toBe(true);
        expect(capabilities.canUseEntityGraph).toBe(true);
        expect(capabilities.canUseReindex).toBe(true);
        expect(capabilities.canUseArchiveImportExport).toBe(true);
    });

    it('withholds every server-only capability under the local transport', () => {
        vi.mocked(isLocalTransportActive).mockReturnValue(true);

        const capabilities = useCapabilities();

        expect(capabilities.isLocalMode).toBe(true);
        expect(capabilities.canUseAdmin).toBe(false);
        expect(capabilities.canUseGroupsAndSharing).toBe(false);
        expect(capabilities.canUsePlugins).toBe(false);
        expect(capabilities.canUseMlOrganize).toBe(false);
        expect(capabilities.canUseEntityGraph).toBe(false);
        expect(capabilities.canUseReindex).toBe(false);
        expect(capabilities.canUseArchiveImportExport).toBe(false);
    });

    it('re-reads the transport on every call rather than caching module-load state', () => {
        vi.mocked(isLocalTransportActive).mockReturnValue(false);
        expect(useCapabilities().canUseAdmin).toBe(true);

        vi.mocked(isLocalTransportActive).mockReturnValue(true);
        expect(useCapabilities().canUseAdmin).toBe(false);
    });
});
