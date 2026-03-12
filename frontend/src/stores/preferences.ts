import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiGetPreferences, apiUpdatePreferences, apiResetPreferences } from '@/api/client';
import type { UserPreferences } from '@/api/types';

const DEFAULT_PREFS: UserPreferences = {
    theme: 'dark',
    editor_mode: 'side_by_side',
    font_size: 14,
};

export const usePreferencesStore = defineStore('preferences', () => {
    const prefs = ref<UserPreferences>({ ...DEFAULT_PREFS });
    const loaded = ref(false);
    const saving = ref(false);

    async function load() {
        try {
            prefs.value = await apiGetPreferences();
            loaded.value = true;
        } catch {
            // Server not yet ready or no auth — use defaults
            prefs.value = { ...DEFAULT_PREFS };
            loaded.value = true;
        }
    }

    async function save() {
        saving.value = true;
        try {
            prefs.value = await apiUpdatePreferences(prefs.value);
        } finally {
            saving.value = false;
        }
    }

    async function reset() {
        prefs.value = await apiResetPreferences();
    }

    function set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
        prefs.value[key] = value;
    }

    return { prefs, loaded, saving, load, save, reset, set };
});
