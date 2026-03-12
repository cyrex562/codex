import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
    apiGetFileTree,
    apiReadFile,
    apiWriteFile,
    apiCreateFile,
    apiDeleteFile,
    apiCreateDirectory,
    apiRenameFile,
    apiGetRandomNote,
    apiGetDailyNote,
    apiGetRecentFiles,
    apiRecordRecentFile,
} from '@/api/client';
import type { FileNode, FileContent, UpdateFileRequest } from '@/api/types';

export const useFilesStore = defineStore('files', () => {
    const tree = ref<FileNode[]>([]);
    const recentFiles = ref<string[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    async function loadTree(vaultId: string) {
        loading.value = true;
        error.value = null;
        try {
            tree.value = await apiGetFileTree(vaultId);
        } catch (e) {
            error.value = String(e);
        } finally {
            loading.value = false;
        }
    }

    async function readFile(vaultId: string, filePath: string): Promise<FileContent> {
        return apiReadFile(vaultId, filePath);
    }

    async function writeFile(
        vaultId: string,
        filePath: string,
        data: UpdateFileRequest,
    ): Promise<FileContent> {
        return apiWriteFile(vaultId, filePath, data);
    }

    async function createFile(
        vaultId: string,
        filePath: string,
        content = '',
    ): Promise<FileContent> {
        const result = await apiCreateFile(vaultId, { path: filePath, content });
        // Refresh tree after mutation
        await loadTree(vaultId);
        return result;
    }

    async function deleteFile(vaultId: string, filePath: string) {
        await apiDeleteFile(vaultId, filePath);
        await loadTree(vaultId);
    }

    async function createDirectory(vaultId: string, path: string) {
        await apiCreateDirectory(vaultId, path);
        await loadTree(vaultId);
    }

    async function renameFile(
        vaultId: string,
        from: string,
        to: string,
        strategy: 'fail' | 'overwrite' | 'rename' = 'fail',
    ): Promise<string> {
        const result = await apiRenameFile(vaultId, from, to, strategy);
        await loadTree(vaultId);
        return result.new_path;
    }

    async function getRandomNote(vaultId: string): Promise<string> {
        const result = await apiGetRandomNote(vaultId);
        return result.path;
    }

    async function getDailyNote(vaultId: string): Promise<FileContent> {
        const today = new Date().toISOString().split('T')[0];
        return apiGetDailyNote(vaultId, today);
    }

    async function loadRecentFiles(vaultId: string) {
        try {
            recentFiles.value = await apiGetRecentFiles(vaultId);
        } catch {
            recentFiles.value = [];
        }
    }

    function recordRecentFile(vaultId: string, filePath: string) {
        // Optimistic local update
        recentFiles.value = [
            filePath,
            ...recentFiles.value.filter((p) => p !== filePath),
        ].slice(0, 20);
        apiRecordRecentFile(vaultId, filePath);
    }

    return {
        tree,
        recentFiles,
        loading,
        error,
        loadTree,
        readFile,
        writeFile,
        createFile,
        deleteFile,
        createDirectory,
        renameFile,
        getRandomNote,
        getDailyNote,
        loadRecentFiles,
        recordRecentFile,
    };
});
