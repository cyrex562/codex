import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/api/client', () => ({
    apiListFavorites: vi.fn(),
    apiAddFavorite: vi.fn(),
    apiRemoveFavorite: vi.fn(),
}));

import { apiListFavorites, apiAddFavorite, apiRemoveFavorite } from '@/api/client';
import { useFavoritesStore } from './favorites';

function makeFavorite(path: string, when = '2026-07-18T00:00:00Z') {
    return {
        user_id: 'u1',
        vault_id: 'v1',
        path,
        created_at: when,
    };
}

describe('useFavoritesStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('load() populates the per-vault list and marks the vault as loaded', async () => {
        vi.mocked(apiListFavorites).mockResolvedValueOnce([makeFavorite('a.md')]);
        const store = useFavoritesStore();

        expect(store.loaded.has('v1')).toBe(false);
        await store.load('v1');

        expect(store.loaded.has('v1')).toBe(true);
        expect(store.favoritesForVault('v1')).toHaveLength(1);
    });

    it('add() prepends the new favorite and does not duplicate on repeat', async () => {
        vi.mocked(apiAddFavorite).mockResolvedValue(makeFavorite('a.md'));
        const store = useFavoritesStore();

        await store.add('v1', 'a.md');
        await store.add('v1', 'a.md');

        expect(store.favoritesForVault('v1')).toHaveLength(1);
    });

    it('remove() drops the matching path and leaves siblings alone', async () => {
        // Prime the store with two favorites.
        vi.mocked(apiListFavorites).mockResolvedValueOnce([
            makeFavorite('a.md'),
            makeFavorite('b.md'),
        ]);
        vi.mocked(apiRemoveFavorite).mockResolvedValue(undefined);
        const store = useFavoritesStore();
        await store.load('v1');

        await store.remove('v1', 'a.md');

        expect(store.favoritesForVault('v1').map((f) => f.path)).toEqual(['b.md']);
    });

    it('toggle() adds when absent and removes when present', async () => {
        vi.mocked(apiAddFavorite).mockResolvedValue(makeFavorite('note.md'));
        vi.mocked(apiRemoveFavorite).mockResolvedValue(undefined);
        const store = useFavoritesStore();

        await store.toggle('v1', 'note.md');
        expect(store.isFavorite('v1', 'note.md')).toBe(true);

        await store.toggle('v1', 'note.md');
        expect(store.isFavorite('v1', 'note.md')).toBe(false);
    });

    it('remapPath() follows both exact and prefix (folder-rename) matches', () => {
        const store = useFavoritesStore();
        // Seed manually — this path exercises pure state without hitting the API.
        store.byVault.set('v1', [
            makeFavorite('projects/one.md'),
            makeFavorite('projects/nested/two.md'),
            makeFavorite('unrelated.md'),
        ]);

        store.remapPath('v1', 'projects', 'archive');

        expect(store.favoritesForVault('v1').map((f) => f.path)).toEqual([
            'archive/one.md',
            'archive/nested/two.md',
            'unrelated.md',
        ]);
    });

    it('scopes favorites by vault — loading vault A does not touch vault B', async () => {
        vi.mocked(apiListFavorites).mockResolvedValueOnce([makeFavorite('a.md')]);
        const store = useFavoritesStore();
        store.byVault.set('other-vault', [makeFavorite('kept.md')]);

        await store.load('v1');

        expect(store.favoritesForVault('other-vault').map((f) => f.path)).toEqual(['kept.md']);
    });
});
