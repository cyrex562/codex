import type { ImportCandidate } from '@/api/types';

type DataTransferItemWithEntry = DataTransferItem & {
    webkitGetAsEntry?: () => FileSystemEntry | null;
};

export function normalizeImportPath(value: string): string {
    return value
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .split('/')
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
}

export function joinImportPath(...segments: Array<string | undefined>): string {
    return normalizeImportPath(segments.filter(Boolean).join('/'));
}

export function parentDirectory(filePath: string): string {
    const normalized = normalizeImportPath(filePath);
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(0, idx) : '';
}

export function hasFilePayload(dataTransfer?: DataTransfer | null): boolean {
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types).includes('Files');
}

export function createImportCandidatesFromFileList(fileList: FileList): ImportCandidate[] {
    return dedupeCandidates(
        Array.from(fileList).map((file) => ({
            file,
            relativePath: normalizeImportPath(file.webkitRelativePath || file.name),
        })),
    );
}

export async function createImportCandidatesFromDataTransfer(
    dataTransfer: DataTransfer,
): Promise<ImportCandidate[]> {
    const items = Array.from(dataTransfer.items ?? []) as DataTransferItemWithEntry[];
    const entryItems = items
        .map((item) => item.webkitGetAsEntry?.() ?? null)
        .filter((entry): entry is FileSystemEntry => entry !== null);

    if (entryItems.length > 0) {
        const collected = await Promise.all(entryItems.map((entry) => readEntry(entry)));
        return dedupeCandidates(collected.flat());
    }

    return createImportCandidatesFromFileList(dataTransfer.files);
}

async function readEntry(entry: FileSystemEntry, parentPath = ''): Promise<ImportCandidate[]> {
    const relativePath = joinImportPath(parentPath, entry.name);

    if (entry.isFile) {
        const file = await readFileEntry(entry as FileSystemFileEntry);
        return [{ file, relativePath }];
    }

    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    const nested = await Promise.all(children.map((child) => readEntry(child, relativePath)));
    return nested.flat();
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = entry.createReader();
    const allEntries: FileSystemEntry[] = [];

    while (true) {
        const chunk = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });

        if (chunk.length === 0) {
            break;
        }

        allEntries.push(...chunk);
    }

    return allEntries;
}

function dedupeCandidates(candidates: ImportCandidate[]): ImportCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        const key = [candidate.relativePath, candidate.file.size, candidate.file.lastModified].join('::');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
