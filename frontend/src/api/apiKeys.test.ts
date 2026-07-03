import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { apiCreateApiKey, apiListApiKeys, apiRevokeApiKey } from './client';
import type { ApiKeyInfo, CreateApiKeyResponse } from './types';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function emptyResponse(status = 204) {
    return new Response(null, { status });
}

describe('api-key client', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        vi.restoreAllMocks();
        localStorage.setItem('obsidian_access_token', 'valid-access');
        localStorage.setItem('obsidian_refresh_token', 'refresh-token');
        localStorage.setItem('obsidian_token_expires_at', String(Date.now() + 3600_000));
    });

    it('apiListApiKeys fetches and returns the list of keys', async () => {
        const keys: ApiKeyInfo[] = [
            {
                id: 'key-1',
                name: 'CI key',
                prefix: 'abcd1234',
                user_id: 'user-1',
                created_at: '2026-01-01T00:00:00Z',
                expires_at: null,
                revoked: false,
            },
            {
                id: 'key-2',
                name: 'Laptop key',
                prefix: 'ef567890',
                user_id: 'user-1',
                created_at: '2026-02-01T00:00:00Z',
                expires_at: '2026-08-01T00:00:00Z',
                revoked: false,
            },
        ];
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(keys));
        vi.stubGlobal('fetch', fetchMock);

        const result = await apiListApiKeys();

        expect(result).toEqual(keys);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('/api/auth/api-keys');
        expect(init?.method === undefined || init?.method === 'GET').toBe(true);
    });

    it('apiCreateApiKey posts the request body and returns the response', async () => {
        const response: CreateApiKeyResponse = {
            id: 'key-3',
            name: 'k',
            api_key: 'obs_live_secret',
            prefix: 'obs_live',
            expires_at: '2026-08-01T00:00:00Z',
        };
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(response));
        vi.stubGlobal('fetch', fetchMock);

        const request = { name: 'k', expires_in_days: 30 };
        const result = await apiCreateApiKey(request);

        expect(result).toEqual(response);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('/api/auth/api-keys');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body as string)).toEqual(request);
    });

    it('apiRevokeApiKey issues a DELETE and resolves to undefined', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => emptyResponse(204));
        vi.stubGlobal('fetch', fetchMock);

        const result = await apiRevokeApiKey('key-1');

        expect(result).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('/api/auth/api-keys/key-1');
        expect(init?.method).toBe('DELETE');
    });
});
