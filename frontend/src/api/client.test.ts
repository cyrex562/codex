import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
    apiCreateUploadSession,
    apiListVaults,
    apiUploadChunk,
    ApiError,
    getTransport,
    httpTransport,
    localTransport,
    setTransport,
    type TransportResponseLike,
} from './client';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Never let one test's transport override leak into another's.
afterEach(() => {
    setTransport(httpTransport);
});

describe('api client auth refresh', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        vi.restoreAllMocks();
    });

    function seedExpiredTokens() {
        localStorage.setItem('obsidian_access_token', 'stale-access');
        localStorage.setItem('obsidian_refresh_token', 'refresh-token');
        localStorage.setItem('obsidian_token_expires_at', '1');
    }

    it('refreshes an expired token before creating an upload session', async () => {
        seedExpiredTokens();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/auth/refresh') {
                return jsonResponse({
                    access_token: 'fresh-access',
                    refresh_token: 'fresh-refresh',
                    expires_in: 3600,
                });
            }
            if (url === '/api/vaults/v1/upload-sessions') {
                expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer fresh-access');
                return jsonResponse({ session_id: 'session-1', uploaded_bytes: 0, total_size: 12 }, 201);
            }
            return jsonResponse({ error: 'unexpected request' }, 500);
        });
        vi.stubGlobal('fetch', fetchMock);

        await apiCreateUploadSession('v1', 'note.md', 12, 'Inbox');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
        expect(fetchMock.mock.calls[1][0]).toBe('/api/vaults/v1/upload-sessions');
    });

    it('refreshes an expired token before uploading a raw chunk', async () => {
        seedExpiredTokens();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === '/api/auth/refresh') {
                return jsonResponse({
                    access_token: 'fresh-access',
                    refresh_token: 'fresh-refresh',
                    expires_in: 3600,
                });
            }
            if (url === '/api/vaults/v1/upload-sessions/session-1') {
                expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer fresh-access');
                return jsonResponse({ uploaded_bytes: 4 });
            }
            return jsonResponse({ error: 'unexpected request' }, 500);
        });
        vi.stubGlobal('fetch', fetchMock);

        await apiUploadChunk('v1', 'session-1', new Blob(['test']));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh');
        expect(fetchMock.mock.calls[1][0]).toBe('/api/vaults/v1/upload-sessions/session-1');
    });
});

describe('pluggable transport (#55)', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        vi.restoreAllMocks();
    });

    function fakeTransportResponse(body: unknown, status = 200): TransportResponseLike {
        const text = JSON.stringify(body);
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: {
                get: (name: string) =>
                    name.toLowerCase() === 'content-type' ? 'application/json' : null,
            },
            json: async () => JSON.parse(text),
            text: async () => text,
        };
    }

    it('produces an identical parsed result through httpTransport and a custom transport', async () => {
        const vaults = [{ id: 'v1', name: 'Vault' }];
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(vaults)));
        const viaHttp = await apiListVaults();

        const customTransport = vi.fn(async () => fakeTransportResponse(vaults));
        setTransport(customTransport);
        const viaCustom = await apiListVaults();

        expect(viaCustom).toEqual(viaHttp);
        expect(customTransport).toHaveBeenCalledTimes(1);
    });

    it('produces an identical ApiError through httpTransport and a custom transport', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'not found' }, 404)));
        const httpErr = (await apiListVaults().catch((e) => e)) as ApiError;
        expect(httpErr).toBeInstanceOf(ApiError);

        setTransport(vi.fn(async () => fakeTransportResponse({ message: 'not found' }, 404)));
        const customErr = (await apiListVaults().catch((e) => e)) as ApiError;

        expect(customErr).toBeInstanceOf(ApiError);
        expect(customErr.status).toBe(httpErr.status);
        expect(customErr.message).toBe(httpErr.message);
        expect(customErr.body).toEqual(httpErr.body);
    });

    it('getTransport reflects the active override', () => {
        const custom = async () => fakeTransportResponse({});
        setTransport(custom);
        expect(getTransport()).toBe(custom);
    });

    it('localTransport is selectable and reports itself as not implemented yet', async () => {
        setTransport(localTransport);
        await expect(apiListVaults()).rejects.toThrow(/not implemented/i);
    });

    it('skips the token-refresh path entirely when a non-HTTP transport is active', async () => {
        localStorage.setItem('obsidian_access_token', 'stale-access');
        localStorage.setItem('obsidian_refresh_token', 'refresh-token');
        localStorage.setItem('obsidian_token_expires_at', '1'); // already expired
        const fetchMock = vi.fn(); // must never be reached
        vi.stubGlobal('fetch', fetchMock);
        setTransport(vi.fn(async () => fakeTransportResponse([])));

        await apiListVaults();

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
