import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
    apiListVaults,
    apiCreateVault,
    apiDeleteVault,
    apiGetVault,
} from '@/api/client';
import type { Vault, CreateVaultRequest } from '@/api/types';

export const useVaultsStore = defineStore('vaults', () => {
    const vaults = ref<Vault[]>([]);
    const activeVaultId = ref<string | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    async function loadVaults() {
        loading.value = true;
        error.value = null;
        try {
            vaults.value = await apiListVaults();
            // Restore last active vault from localStorage
            const saved = localStorage.getItem('obsidian_active_vault');
            if (saved && vaults.value.some((v) => v.id === saved)) {
                activeVaultId.value = saved;
            }
        } catch (e) {
            error.value = String(e);
        } finally {
            loading.value = false;
        }
    }

    async function createVault(data: CreateVaultRequest): Promise<Vault> {
        const vault = await apiCreateVault(data);
        vaults.value.push(vault);
        return vault;
    }

    async function deleteVault(id: string) {
        await apiDeleteVault(id);
        vaults.value = vaults.value.filter((v) => v.id !== id);
        if (activeVaultId.value === id) {
            setActiveVault(null);
        }
    }

    async function refreshVault(id: string) {
        const updated = await apiGetVault(id);
        const idx = vaults.value.findIndex((v) => v.id === id);
        if (idx !== -1) vaults.value[idx] = updated;
    }

    function setActiveVault(id: string | null) {
        activeVaultId.value = id;
        if (id) {
            localStorage.setItem('obsidian_active_vault', id);
        } else {
            localStorage.removeItem('obsidian_active_vault');
        }
    }

    function getActive(): Vault | undefined {
        return vaults.value.find((v) => v.id === activeVaultId.value);
    }

    return {
        vaults,
        activeVaultId,
        loading,
        error,
        loadVaults,
        createVault,
        deleteVault,
        refreshVault,
        setActiveVault,
        getActive,
    };
});
