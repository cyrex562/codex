import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUndoRedo } from './useUndoRedo';

describe('useUndoRedo', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('undo returns the initial content passed to the constructor, not something else', () => {
        // Regression test for a real bug: MarkdownEditor.vue used to call
        // useUndoRedo(props.tabId) — a UUID string — instead of
        // useUndoRedo(props.content). The first undo past the first edit
        // would then replace the whole document with the tab id.
        const { recordChange, undo } = useUndoRedo('the actual starting content');
        recordChange('edited content');
        vi.advanceTimersByTime(1000); // flush the debounce

        expect(undo()).toBe('the actual starting content');
    });

    it('recordChange debounces into a single undo step', () => {
        const { recordChange, undo } = useUndoRedo('start', { debounceMs: 300 });
        recordChange('s');
        recordChange('st');
        recordChange('sta');
        vi.advanceTimersByTime(1000);

        expect(undo()).toBe('start');
        expect(undo()).toBeNull(); // only one step was recorded
    });

    it('redo restores what undo just undid', () => {
        const { recordChange, undo, redo } = useUndoRedo('start');
        recordChange('changed');
        vi.advanceTimersByTime(1000);

        expect(undo()).toBe('start');
        expect(redo()).toBe('changed');
    });

    it('reset clears history and rebaselines to the given content', () => {
        // This is what MarkdownEditor.vue now calls when switching tabs —
        // without it, undo could pull in a *different* note's history, since
        // the editor component is reused (not remounted) across tab switches.
        const { recordChange, undo, reset } = useUndoRedo('note A content');
        recordChange('note A edited');
        vi.advanceTimersByTime(1000);

        reset('note B content');

        expect(undo()).toBeNull(); // no history survives a reset
    });

    it('canUndo/canRedo reflect stack state', () => {
        const { recordChange, undo, canUndo, canRedo } = useUndoRedo('start');
        expect(canUndo.value).toBe(false);
        expect(canRedo.value).toBe(false);

        recordChange('changed');
        expect(canUndo.value).toBe(true);

        vi.advanceTimersByTime(1000);
        undo();
        expect(canRedo.value).toBe(true);
    });
});
