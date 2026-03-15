import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ImportCandidate } from '@/api/types';

export interface ConflictState {
    tabId: string;
    filePath: string;
    yourVersion: string;
    serverVersion: string;
    serverModified?: string;
}

export interface ImportDialogOptions {
    targetPath?: string;
    entries?: ImportCandidate[];
    append?: boolean;
}

export const useUiStore = defineStore('ui', () => {
    const templateSelectorOpen = ref(false);
    const conflictResolverOpen = ref(false);
    const conflictState = ref<ConflictState | null>(null);
    const importDialogOpen = ref(false);
    const importTargetPath = ref('');
    const importEntries = ref<ImportCandidate[]>([]);

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

    function openImportDialog(options: ImportDialogOptions = {}) {
        importTargetPath.value = options.targetPath ?? importTargetPath.value;
        if (options.entries) {
            importEntries.value = options.append
                ? [...importEntries.value, ...options.entries]
                : [...options.entries];
        } else if (!options.append) {
            importEntries.value = [];
        }
        importDialogOpen.value = true;
    }

    function closeImportDialog() {
        importDialogOpen.value = false;
        importTargetPath.value = '';
        importEntries.value = [];
    }

    function setImportEntries(entries: ImportCandidate[]) {
        importEntries.value = [...entries];
    }

    function appendImportEntries(entries: ImportCandidate[]) {
        importEntries.value = [...importEntries.value, ...entries];
    }

    function clearImportEntries() {
        importEntries.value = [];
    }

    return {
        templateSelectorOpen,
        conflictResolverOpen,
        conflictState,
        importDialogOpen,
        importTargetPath,
        importEntries,
        openTemplateSelector,
        closeTemplateSelector,
        openConflictResolver,
        closeConflictResolver,
        openImportDialog,
        closeImportDialog,
        setImportEntries,
        appendImportEntries,
        clearImportEntries,
    };
});
