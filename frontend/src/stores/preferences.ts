import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiGetPreferences, apiUpdatePreferences, apiResetPreferences } from '@/api/client';
import type { UserPreferences } from '@/api/types';

const DEFAULT_PREFS: UserPreferences = {
    theme: 'dark',
    editor_mode: 'formatted_raw',
    font_size: 14,
    icon_map: {},
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

    function getIcon(path: string): string | undefined {
        return prefs.value.icon_map?.[path];
    }

    function setIcon(path: string, icon: string) {
        if (!prefs.value.icon_map) prefs.value.icon_map = {};
        prefs.value.icon_map[path] = icon;
    }

    function clearIcon(path: string) {
        if (!prefs.value.icon_map) return;
        delete prefs.value.icon_map[path];
    }

    function clearIconsUnderPath(path: string) {
        if (!prefs.value.icon_map) return;
        delete prefs.value.icon_map[path];
        const prefix = `${path}/`;
        for (const key of Object.keys(prefs.value.icon_map)) {
            if (key.startsWith(prefix)) {
                delete prefs.value.icon_map[key];
            }
        }
    }

    function remapPathIcon(fromPath: string, toPath: string) {
        if (!prefs.value.icon_map) return;
        const direct = prefs.value.icon_map[fromPath];
        if (direct !== undefined) {
            prefs.value.icon_map[toPath] = direct;
            delete prefs.value.icon_map[fromPath];
        }

        const prefix = `${fromPath}/`;
        const newPrefix = `${toPath}/`;
        for (const key of Object.keys(prefs.value.icon_map)) {
            if (!key.startsWith(prefix)) continue;
            const value = prefs.value.icon_map[key];
            const mapped = `${newPrefix}${key.slice(prefix.length)}`;
            prefs.value.icon_map[mapped] = value;
            delete prefs.value.icon_map[key];
        }
    }

    return {
        prefs,
        loaded,
        saving,
        load,
        save,
        reset,
        set,
        getIcon,
        setIcon,
        clearIcon,
        clearIconsUnderPath,
        remapPathIcon,
    };
});
