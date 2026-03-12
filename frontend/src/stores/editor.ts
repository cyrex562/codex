import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { EditorMode } from '@/api/types';

export const useEditorStore = defineStore('editor', () => {
    const mode = ref<EditorMode>('side_by_side');
    // Per-tab pending auto-save timers (tabId → timer handle)
    const autoSaveTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    function setMode(newMode: EditorMode) {
        mode.value = newMode;
    }

    function scheduleAutoSave(tabId: string, delayMs: number, callback: () => void) {
        const existing = autoSaveTimers.value.get(tabId);
        if (existing !== undefined) clearTimeout(existing);
        const handle = setTimeout(() => {
            autoSaveTimers.value.delete(tabId);
            callback();
        }, delayMs);
        autoSaveTimers.value.set(tabId, handle);
    }

    function cancelAutoSave(tabId: string) {
        const handle = autoSaveTimers.value.get(tabId);
        if (handle !== undefined) {
            clearTimeout(handle);
            autoSaveTimers.value.delete(tabId);
        }
    }

    return { mode, setMode, scheduleAutoSave, cancelAutoSave };
});
