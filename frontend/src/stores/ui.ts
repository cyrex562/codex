import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ConflictState {
    tabId: string;
    filePath: string;
    yourVersion: string;
    serverVersion: string;
    serverModified?: string;
}

export const useUiStore = defineStore('ui', () => {
    const templateSelectorOpen = ref(false);
    const conflictResolverOpen = ref(false);
    const conflictState = ref<ConflictState | null>(null);

    function openTemplateSelector() {
        templateSelectorOpen.value = true;
    }

    function closeTemplateSelector() {
        templateSelectorOpen.value = false;
    }

    function openConflictResolver(data: ConflictState) {
        conflictState.value = data;
        conflictResolverOpen.value = true;
    }

    function closeConflictResolver() {
        conflictResolverOpen.value = false;
        conflictState.value = null;
    }

    return {
        templateSelectorOpen,
        conflictResolverOpen,
        conflictState,
        openTemplateSelector,
        closeTemplateSelector,
        openConflictResolver,
        closeConflictResolver,
    };
});
