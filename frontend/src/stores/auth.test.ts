import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/api/client', () => ({
    apiLogin: vi.fn(),
    apiRefreshToken: vi.fn(),
    apiLogout: vi.fn(),
    apiMe: vi.fn(),
    apiChangePassword: vi.fn(),
    apiVerifyTotpLogin: vi.fn(),
}));

vi.mock('@/utils/tauri', () => ({
    isTauri: vi.fn(() => false),
}));

import {
    apiLogin,
    apiLogout,
    apiMe,
    apiRefreshToken,
    apiChangePassword,
    apiVerifyTotpLogin,
} from '@/api/client';
import { isTauri } from '@/utils/tauri';
import { useAuthStore } from './auth';

const mockProfile = {
    id: 'u1',
    username: 'alice',
    is_admin: false,
    must_change_password: false,
    groups: [],
    auth_method: 'password',
};

describe('useAuthStore', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('stores pending TOTP state after password login without loading the profile', async () => {
        vi.mocked(apiLogin).mockResolvedValueOnce({
            access_token: 'pending-access',
            refresh_token: 'pending-refresh',
            expires_in: 3600,
            totp_required: true,
        });

        const store = useAuthStore();
        await store.login('alice', 'correct-horse-battery-staple');

        expect(store.pendingTotp).toBe(true);
        expect(store.isAuthenticated).toBe(false);
        expect(store.profile).toBeNull();
        expect(localStorage.getItem('obsidian_pending_totp')).toBe('true');
        expect(localStorage.getItem('obsidian_access_token')).toBe('pending-access');
        // LIB-089: refresh token is held in memory + the HttpOnly cookie, never
        // persisted to localStorage.
        expect(store.refreshToken).toBe('pending-refresh');
        expect(localStorage.getItem('obsidian_refresh_token')).toBeNull();
        expect(apiMe).not.toHaveBeenCalled();
    });

    it('completes TOTP login, clears pending state, and loads the authenticated profile', async () => {
        localStorage.setItem('obsidian_pending_totp', 'true');
        localStorage.setItem('obsidian_access_token', 'pending-access');
        localStorage.setItem('obsidian_token_expires_at', String(Date.now() + 60_000));

        vi.mocked(apiVerifyTotpLogin).mockResolvedValueOnce({
            success: true,
            access_token: 'verified-access',
            refresh_token: 'verified-refresh',
            expires_in: 3600,
        });
        vi.mocked(apiMe).mockResolvedValueOnce({ ...mockProfile });

        const store = useAuthStore();
        await store.completeTotpLogin('123456');

        expect(apiVerifyTotpLogin).toHaveBeenCalledWith('123456');
        expect(apiMe).toHaveBeenCalledTimes(1);
        expect(store.pendingTotp).toBe(false);
        expect(store.isAuthenticated).toBe(true);
        expect(store.profile).toEqual(mockProfile);
        expect(localStorage.getItem('obsidian_pending_totp')).toBe('false');
        expect(localStorage.getItem('obsidian_access_token')).toBe('verified-access');
        // LIB-089: refresh token in memory only, not localStorage.
        expect(store.refreshToken).toBe('verified-refresh');
        expect(localStorage.getItem('obsidian_refresh_token')).toBeNull();
    });

    it('passes the refresh token to logout and clears pending TOTP auth state', async () => {
        localStorage.setItem('obsidian_pending_totp', 'true');
        localStorage.setItem('obsidian_access_token', 'pending-access');
        localStorage.setItem('obsidian_token_expires_at', String(Date.now() + 60_000));

        const store = useAuthStore();
        await store.logout();

        // LIB-089: logout no longer passes a token — the server reads the
        // HttpOnly refresh cookie and clears it.
        expect(apiLogout).toHaveBeenCalledWith();
        expect(store.accessToken).toBeNull();
        expect(store.refreshToken).toBeNull();
        expect(store.pendingTotp).toBe(false);
        expect(store.profile).toBeNull();
        expect(store.isAuthenticated).toBe(false);
        expect(localStorage.getItem('obsidian_access_token')).toBeNull();
        expect(localStorage.getItem('obsidian_refresh_token')).toBeNull();
        expect(localStorage.getItem('obsidian_pending_totp')).toBeNull();
    });

    it('preserves pending TOTP state across refresh responses until verification completes', async () => {
        localStorage.setItem('obsidian_pending_totp', 'true');
        localStorage.setItem('obsidian_access_token', 'pending-access');
        localStorage.setItem('obsidian_refresh_token', 'pending-refresh');
        localStorage.setItem('obsidian_token_expires_at', '1');

        vi.mocked(apiRefreshToken).mockResolvedValueOnce({
            access_token: 'refreshed-access',
            refresh_token: 'refreshed-refresh',
            expires_in: 3600,
            totp_required: true,
        });

        const store = useAuthStore();
        await store.refresh();

        // LIB-089: refresh reads the HttpOnly cookie server-side; no token arg.
        expect(apiRefreshToken).toHaveBeenCalledWith();
        expect(store.pendingTotp).toBe(true);
        expect(store.isAuthenticated).toBe(false);
        expect(localStorage.getItem('obsidian_pending_totp')).toBe('true');
        expect(localStorage.getItem('obsidian_access_token')).toBe('refreshed-access');
    });

    it('coalesces concurrent stale-token refresh attempts', async () => {
        localStorage.setItem('obsidian_access_token', 'stale-access');
        localStorage.setItem('obsidian_refresh_token', 'refresh-token');
        localStorage.setItem('obsidian_token_expires_at', '1');

        vi.mocked(apiRefreshToken).mockResolvedValueOnce({
            access_token: 'fresh-access',
            refresh_token: 'fresh-refresh',
            expires_in: 3600,
            totp_required: false,
        });

        const store = useAuthStore();
        await Promise.all([store.ensureFresh(), store.ensureFresh(), store.ensureFresh()]);

        expect(apiRefreshToken).toHaveBeenCalledTimes(1);
        expect(store.accessToken).toBe('fresh-access');
    });

    // Regression: `isExpired` used to be a Vue `computed` reading a
    // non-reactive `Date.now()`. Vue would cache the first "not expired"
    // result after `expiresAt` was set and keep returning it for the rest
    // of the session — so `ensureFresh` never triggered a refresh, and
    // the token silently expired mid-session. The rewritten function must
    // re-read the wall clock on every call.
    it('ensureFresh triggers a refresh when time passes past expiresAt', async () => {
        const start = 1_000_000_000_000; // arbitrary fixed epoch ms
        vi.spyOn(Date, 'now').mockReturnValue(start);

        vi.mocked(apiLogin).mockResolvedValueOnce({
            access_token: 'a0',
            refresh_token: 'r0',
            expires_in: 3600, // 1h TTL — expires at start + 3_600_000
            totp_required: false,
        });
        vi.mocked(apiMe).mockResolvedValueOnce({ ...mockProfile });

        const store = useAuthStore();
        await store.login('alice', 'password');
        expect(apiRefreshToken).not.toHaveBeenCalled();

        // First call while the token is still comfortably fresh — no refresh.
        vi.spyOn(Date, 'now').mockReturnValue(start + 60_000);
        await store.ensureFresh();
        expect(apiRefreshToken).not.toHaveBeenCalled();

        // Advance the wall clock past `expiresAt - 60_000`. A Vue `computed`
        // would still be cached at "not expired" and NOT trigger refresh; a
        // plain function re-reads the clock every call and does. This is the
        // load-bearing assertion — it's the regression that caused sessions
        // to silently die between wake-from-sleep cycles.
        vi.spyOn(Date, 'now').mockReturnValue(start + 3_600_000);
        vi.mocked(apiRefreshToken).mockResolvedValueOnce({
            access_token: 'a1',
            refresh_token: 'r0',
            expires_in: 3600,
            totp_required: false,
        });
        await store.ensureFresh();

        expect(apiRefreshToken).toHaveBeenCalledTimes(1);
        expect(store.accessToken).toBe('a1');
    });

    describe('desktop (Tauri) refresh-token persistence', () => {
        beforeEach(() => {
            vi.mocked(isTauri).mockReturnValue(true);
        });
        afterEach(() => {
            vi.mocked(isTauri).mockReturnValue(false);
        });

        it('persists the refresh token to localStorage and sends it in the refresh body', async () => {
            vi.mocked(apiLogin).mockResolvedValueOnce({
                access_token: 'desktop-access',
                refresh_token: 'desktop-refresh',
                expires_in: 3600,
                totp_required: false,
            });
            vi.mocked(apiMe).mockResolvedValueOnce({ ...mockProfile });

            const store = useAuthStore();
            await store.login('alice', 'password');

            expect(localStorage.getItem('obsidian_refresh_token')).toBe('desktop-refresh');

            vi.mocked(apiRefreshToken).mockResolvedValueOnce({
                access_token: 'refreshed-access',
                refresh_token: 'desktop-refresh',
                expires_in: 3600,
                totp_required: false,
            });
            await store.refresh();

            // Desktop path passes the persisted token in the body so the request
            // doesn't depend on the (unreliable) WebView cookie.
            expect(apiRefreshToken).toHaveBeenCalledWith('desktop-refresh');
        });

        it('restores the refresh token from localStorage on store re-init (app restart)', async () => {
            localStorage.setItem('obsidian_access_token', 'stale-access');
            localStorage.setItem('obsidian_refresh_token', 'persisted-refresh');
            localStorage.setItem('obsidian_token_expires_at', '1');

            vi.mocked(apiRefreshToken).mockResolvedValueOnce({
                access_token: 'fresh-access',
                refresh_token: 'persisted-refresh',
                expires_in: 3600,
                totp_required: false,
            });

            const store = useAuthStore();
            expect(store.refreshToken).toBe('persisted-refresh');

            await store.ensureFresh();

            expect(apiRefreshToken).toHaveBeenCalledWith('persisted-refresh');
            expect(store.accessToken).toBe('fresh-access');
        });

        it('clears the persisted refresh token on logout and passes it to the server', async () => {
            localStorage.setItem('obsidian_access_token', 'a');
            localStorage.setItem('obsidian_refresh_token', 'to-revoke');

            const store = useAuthStore();
            await store.logout();

            expect(apiLogout).toHaveBeenCalledWith('to-revoke');
            expect(localStorage.getItem('obsidian_refresh_token')).toBeNull();
            expect(store.refreshToken).toBeNull();
        });
    });

    it('flagPendingTotp sets pendingTotp and persists to localStorage without clearing the token', () => {
        localStorage.setItem('obsidian_access_token', 'existing-token');
        localStorage.setItem('obsidian_pending_totp', 'false');

        const store = useAuthStore();
        store.flagPendingTotp();

        expect(store.pendingTotp).toBe(true);
        expect(store.isAuthenticated).toBe(false);
        // Access token is preserved so the TOTP verify call can still be made.
        expect(store.accessToken).toBe('existing-token');
        expect(localStorage.getItem('obsidian_pending_totp')).toBe('true');
    });

    it('loads the profile immediately for a non-TOTP login', async () => {
        vi.mocked(apiLogin).mockResolvedValueOnce({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
            totp_required: false,
        });
        vi.mocked(apiMe).mockResolvedValueOnce({ ...mockProfile });

        const store = useAuthStore();
        await store.login('alice', 'password');

        expect(store.pendingTotp).toBe(false);
        expect(store.isAuthenticated).toBe(true);
        expect(store.profile).toEqual(mockProfile);
        expect(apiMe).toHaveBeenCalledTimes(1);
    });
});
