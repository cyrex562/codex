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
    apiCreateUploadSession,
    apiUploadChunk,
    apiFinishUploadSession,
    apiImportArchive,
    apiDownloadZip,
    apiDownloadTar,
    ApiError,
} from '@/api/client';
import type {
    FileNode,
    FileContent,
    UpdateFileRequest,
    ImportCandidate,
    ImportProgress,
    ImportResult,
    ImportResultItem,
} from '@/api/types';

function normalizePath(value: string): string {
    return value
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .join('/');
}

function joinPath(...segments: Array<string | undefined>): string {
    return normalizePath(segments.filter(Boolean).join('/'));
}

function dirname(filePath: string): string {
    const normalized = normalizePath(filePath);
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(0, idx) : '';
}

function isArchiveFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
}

function triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

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

    async function createDirectoryIfMissing(vaultId: string, path: string) {
        if (!path) return;

        try {
            await apiCreateDirectory(vaultId, path);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
                return;
            }
            throw error;
        }
    }

    async function uploadCandidateFile(
        vaultId: string,
        candidate: ImportCandidate,
        targetDirectory: string,
        onProgress?: (uploadedBytes: number) => void,
        conflict: 'fail' | 'overwrite' | 'rename_with_timestamp' = 'rename_with_timestamp',
    ): Promise<ImportResultItem> {
        const session = await apiCreateUploadSession(
            vaultId,
            candidate.file.name,
            candidate.file.size,
            targetDirectory,
        );

        const chunkSize = 2 * 1024 * 1024;
        let uploadedBytes = 0;

        while (uploadedBytes < candidate.file.size) {
            const end = Math.min(uploadedBytes + chunkSize, candidate.file.size);
            const chunk = candidate.file.slice(uploadedBytes, end);
            const response = await apiUploadChunk(vaultId, session.session_id, chunk);
            uploadedBytes = response.uploaded_bytes;
            onProgress?.(uploadedBytes);
        }

        return apiFinishUploadSession(
            vaultId,
            session.session_id,
            candidate.file.name,
            targetDirectory,
            conflict,
        );
    }

    async function importCandidates(
        vaultId: string,
        candidates: ImportCandidate[],
        targetPath = '',
        onProgress?: (progress: ImportProgress) => void,
        conflict: 'fail' | 'overwrite' | 'rename_with_timestamp' = 'rename_with_timestamp',
    ): Promise<ImportResult> {
        const normalizedTarget = normalizePath(targetPath);

        // Separate regular files from archives (.zip / .tar / .tar.gz / .tgz)
        const archiveCandidates = candidates.filter((c) => isArchiveFile(c.file.name));
        const regularCandidates = candidates.filter((c) => !isArchiveFile(c.file.name));

        const totalFiles = candidates.length;
        const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.file.size, 0);
        const uploaded: ImportResultItem[] = [];
        let completedFiles = 0;
        let baseUploadedBytes = 0;

        onProgress?.({
            totalFiles,
            completedFiles,
            totalBytes,
            uploadedBytes: 0,
        });

        // ── 1. Extract archives via the dedicated endpoint ───────────────────
        for (const candidate of archiveCandidates) {
            const currentFile = candidate.relativePath;
            onProgress?.({
                totalFiles,
                completedFiles,
                totalBytes,
                uploadedBytes: baseUploadedBytes,
                currentFile,
            });

            const result = await apiImportArchive(vaultId, candidate.file, normalizedTarget);
            // Represent each extracted path as a pseudo-result item
            for (const extractedPath of result.extracted) {
                uploaded.push({ path: extractedPath, filename: extractedPath.split('/').pop() ?? '', size: 0 });
            }
            completedFiles += 1;
            baseUploadedBytes += candidate.file.size;
            onProgress?.({
                totalFiles,
                completedFiles,
                totalBytes,
                uploadedBytes: baseUploadedBytes,
            });
        }

        // ── 2. Pre-create directories for regular files ──────────────────────
        const directories = new Set<string>();
        for (const candidate of regularCandidates) {
            const relativeDir = dirname(candidate.relativePath);
            const destinationDir = joinPath(normalizedTarget, relativeDir);
            if (destinationDir) {
                const segments = destinationDir.split('/');
                for (let i = 0; i < segments.length; i += 1) {
                    directories.add(segments.slice(0, i + 1).join('/'));
                }
            }
        }

        const orderedDirectories = [...directories].sort((a, b) => a.split('/').length - b.split('/').length);
        for (const directory of orderedDirectories) {
            await createDirectoryIfMissing(vaultId, directory);
        }

        // ── 3. Upload regular files ──────────────────────────────────────────
        for (const candidate of regularCandidates) {
            const relativeDir = dirname(candidate.relativePath);
            const destinationDir = joinPath(normalizedTarget, relativeDir);
            const currentFile = candidate.relativePath;

            const result = await uploadCandidateFile(vaultId, candidate, destinationDir, (fileUploadedBytes) => {
                onProgress?.({
                    totalFiles,
                    completedFiles,
                    totalBytes,
                    uploadedBytes: baseUploadedBytes + fileUploadedBytes,
                    currentFile,
                });
            }, conflict);

            uploaded.push(result);
            completedFiles += 1;
            baseUploadedBytes += candidate.file.size;
            onProgress?.({
                totalFiles,
                completedFiles,
                totalBytes,
                uploadedBytes: baseUploadedBytes,
                currentFile,
            });
        }

        await loadTree(vaultId);

        return {
            uploaded,
            directoryCount: orderedDirectories.length,
            totalBytes,
        };
    }

    /** Download selected vault paths as a ZIP file and trigger a browser download. */
    async function downloadAsZip(vaultId: string, paths: string[]): Promise<void> {
        const blob = await apiDownloadZip(vaultId, paths);
        triggerBlobDownload(blob, paths.length === 1 ? `${paths[0].split('/').pop() ?? 'download'}.zip` : `${paths.length}_files.zip`);
    }

    /** Download selected vault paths as a tar.gz and trigger a browser download. */
    async function downloadAsTar(vaultId: string, paths: string[]): Promise<void> {
        const blob = await apiDownloadTar(vaultId, paths);
        triggerBlobDownload(blob, paths.length === 1 ? `${paths[0].split('/').pop() ?? 'download'}.tar.gz` : `${paths.length}_files.tar.gz`);
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
        importCandidates,
        downloadAsZip,
        downloadAsTar,
    };
});
