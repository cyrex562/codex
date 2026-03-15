export const FILE_TREE_DRAG_TYPE = 'application/x-obsidian-host-tree-node';

export interface FileTreeDragPayload {
    path: string;
    name: string;
    isDirectory: boolean;
}

export function setFileTreeDragPayload(dataTransfer: DataTransfer, payload: FileTreeDragPayload) {
    const serialized = JSON.stringify(payload);
    dataTransfer.setData(FILE_TREE_DRAG_TYPE, serialized);
    // Fallback so some browsers keep the drag operation alive.
    dataTransfer.setData('text/plain', payload.path);
    dataTransfer.effectAllowed = 'move';
}

export function getFileTreeDragPayload(dataTransfer?: DataTransfer | null): FileTreeDragPayload | null {
    if (!dataTransfer || !Array.from(dataTransfer.types).includes(FILE_TREE_DRAG_TYPE)) {
        return null;
    }

    try {
        return JSON.parse(dataTransfer.getData(FILE_TREE_DRAG_TYPE)) as FileTreeDragPayload;
    } catch {
        return null;
    }
}

export function hasFileTreeDragPayload(dataTransfer?: DataTransfer | null): boolean {
    return getFileTreeDragPayload(dataTransfer) !== null;
}
