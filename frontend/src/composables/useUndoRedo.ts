import { ref } from 'vue';

interface EditCommand {
    execute(): string;
    undo(): string;
    timestamp: number;
}

class TextChangeCommand implements EditCommand {
    readonly timestamp: number;
    constructor(private readonly oldContent: string, private readonly newContent: string) {
        this.timestamp = Date.now();
    }
    execute(): string { return this.newContent; }
    undo(): string { return this.oldContent; }
}

export function useUndoRedo(initialContent: string, options?: { maxStackSize?: number; debounceMs?: number }) {
    const maxStackSize = options?.maxStackSize ?? 100;
    const debounceMs = options?.debounceMs ?? 300;

    const undoStack: EditCommand[] = [];
    const redoStack: EditCommand[] = [];
    let lastContent = initialContent;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingOldContent: string | null = null;

    const canUndo = ref(false);
    const canRedo = ref(false);

    function _updateFlags() {
        canUndo.value = undoStack.length > 0 || pendingOldContent !== null;
        canRedo.value = redoStack.length > 0;
    }

    function _pushCommand(cmd: EditCommand) {
        undoStack.push(cmd);
        redoStack.splice(0); // clear redo
        if (undoStack.length > maxStackSize) undoStack.shift();
        _updateFlags();
    }

    function _commitChange(newContent: string) {
        if (pendingOldContent === null || pendingOldContent === newContent) {
            pendingOldContent = null;
            return;
        }
        _pushCommand(new TextChangeCommand(pendingOldContent, newContent));
        pendingOldContent = null;
        debounceTimer = null;
    }

    function flush() {
        if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
        if (pendingOldContent !== null && pendingOldContent !== lastContent) {
            _pushCommand(new TextChangeCommand(pendingOldContent, lastContent));
        }
        pendingOldContent = null;
        _updateFlags();
    }

    function recordChange(newContent: string) {
        if (newContent === lastContent) return;
        if (pendingOldContent === null) pendingOldContent = lastContent;
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => _commitChange(newContent), debounceMs);
        lastContent = newContent;
        _updateFlags();
    }

    function undo(): string | null {
        flush();
        if (undoStack.length === 0) return null;
        const cmd = undoStack.pop()!;
        redoStack.push(cmd);
        lastContent = cmd.undo();
        _updateFlags();
        return lastContent;
    }

    function redo(): string | null {
        flush();
        if (redoStack.length === 0) return null;
        const cmd = redoStack.pop()!;
        undoStack.push(cmd);
        lastContent = cmd.execute();
        _updateFlags();
        return lastContent;
    }

    function reset(content: string) {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        undoStack.splice(0);
        redoStack.splice(0);
        lastContent = content;
        pendingOldContent = null;
        debounceTimer = null;
        _updateFlags();
    }

    function getCurrent(): string { return lastContent; }

    return { canUndo, canRedo, recordChange, flush, undo, redo, reset, getCurrent };
}
