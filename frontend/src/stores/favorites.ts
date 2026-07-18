import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiListFavorites, apiAddFavorite, apiRemoveFavorite } from '@/api/client';
import type { Favorite } from '@/api/types';

// Per-vault, per-user favorite notes. The backend already scopes to the
// authenticated user via the auth middleware; on the client we key the map by
// vault so multiple vaults can coexist without cross-contamination and a vault
// switch shows the correct list immediately without a spurious "empty" flash.

export const useFavoritesStore = defineStore('favorites', () => {
    const byVault = ref<Map<string, Favorite[]>>(new Map());
    /** Vault ids that have been loaded at least once — distinguishes
     *  "not yet fetched" from "confirmed empty" for the UI. */
    const loaded = ref<Set<string>>(new Set());

    function favoritesForVault(vaultId: string): Favorite[] {
        return byVault.value.get(vaultId) ?? [];
    }

    function isFavorite(vaultId: string, path: string): boolean {
        return favoritesForVault(vaultId).some((f) => f.path === path);
    }

    async function load(vaultId: string): Promise<void> {
        const list = await apiListFavorites(vaultId);
        byVault.value.set(vaultId, list);
        loaded.value.add(vaultId);
    }

    async function add(vaultId: string, path: string): Promise<void> {
        const favorite = await apiAddFavorite(vaultId, path);
        const current = byVault.value.get(vaultId) ?? [];
        // Idempotent on the client too: a repeat star doesn't grow the list.
        if (!current.some((f) => f.path === favorite.path)) {
            byVault.value.set(vaultId, [favorite, ...current]);
        }
    }

    async function remove(vaultId: string, path: string): Promise<void> {
        await apiRemoveFavorite(vaultId, path);
        const current = byVault.value.get(vaultId) ?? [];
        byVault.value.set(
            vaultId,
            current.filter((f) => f.path !== path),
        );
    }

    /** Toggle without a preceding `isFavorite` call at the caller. */
    async function toggle(vaultId: string, path: string): Promise<void> {
        if (isFavorite(vaultId, path)) {
            await remove(vaultId, path);
        } else {
            await add(vaultId, path);
        }
    }

    /** Follow a rename on the server: keep the star pointing at the new path. */
    function remapPath(vaultId: string, fromPath: string, toPath: string): void {
        const current = byVault.value.get(vaultId);
        if (!current) return;
        const prefix = `${fromPath}/`;
        const newPrefix = `${toPath}/`;
        const next = current.map((f) => {
            if (f.path === fromPath) return { ...f, path: toPath };
            if (f.path.startsWith(prefix)) {
                return { ...f, path: newPrefix + f.path.slice(prefix.length) };
            }
            return f;
        });
        byVault.value.set(vaultId, next);
    }

    return {
        byVault,
        loaded,
        favoritesForVault,
        isFavorite,
        load,
        add,
        remove,
        toggle,
        remapPath,
    };
});
