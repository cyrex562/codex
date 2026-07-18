import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/tauri', () => ({
    isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { isTauri } from '@/utils/tauri';
import { getLogger, buffer, _resetForTests } from './logger';

async function getInvoke() {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke as unknown as ReturnType<typeof vi.fn>;
}

describe('logger', () => {
    beforeEach(() => {
        _resetForTests();
        vi.mocked(isTauri).mockReturnValue(false);
        vi.clearAllMocks();
    });

    it('writes records into the in-memory ring buffer', () => {
        const log = getLogger('test');
        log.info('hello');
        log.warn('careful', { attempt: 2 });

        const buf = buffer();
        expect(buf).toHaveLength(2);
        expect(buf[0].message).toBe('hello');
        expect(buf[1].context).toEqual({ attempt: 2 });
        expect(buf[1].level).toBe('warn');
    });

    it('caps the ring buffer to prevent unbounded growth', () => {
        const log = getLogger('test');
        // 501 entries → the very first one should be evicted (capacity 500).
        for (let i = 0; i < 501; i++) log.info(`entry-${i}`);
        const buf = buffer();
        expect(buf).toHaveLength(500);
        expect(buf[0].message).toBe('entry-1');
        expect(buf[buf.length - 1].message).toBe('entry-500');
    });

    it('does NOT invoke the Tauri command in a browser context', async () => {
        const invoke = await getInvoke();
        vi.mocked(isTauri).mockReturnValue(false);

        getLogger('test').info('browser only');

        expect(invoke).not.toHaveBeenCalled();
    });

    it('DOES invoke the Tauri command when running inside a Tauri WebView', async () => {
        const invoke = await getInvoke();
        vi.mocked(isTauri).mockReturnValue(true);
        invoke.mockResolvedValueOnce(undefined);

        getLogger('auth').warn('refresh failed', { attempt: 3 });
        // Fire-and-forget uses a dynamic import + an await inside the wrapper;
        // give the microtask queue a few full turns so both settle before the
        // assertion.
        await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

        expect(invoke).toHaveBeenCalledWith('frontend_log', {
            record: {
                level: 'warn',
                source: 'auth',
                message: 'refresh failed',
                context: { attempt: 3 },
            },
        });
    });

    it('swallows Tauri IPC errors so a broken log never breaks real work', async () => {
        const invoke = await getInvoke();
        vi.mocked(isTauri).mockReturnValue(true);
        invoke.mockRejectedValueOnce(new Error('IPC broke'));

        expect(() => getLogger('test').error('boom')).not.toThrow();
        // Buffer still updated.
        expect(buffer()).toHaveLength(1);
    });

    it('binds the source tag once per getLogger factory call', () => {
        getLogger('auth').info('a');
        getLogger('router').info('b');

        const buf = buffer();
        expect(buf.map((r) => r.source)).toEqual(['auth', 'router']);
    });
});
