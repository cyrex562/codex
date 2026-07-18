import { describe, it, expect } from 'vitest';
import { applyListIndent } from './list-indent';

// Convenience: fixtures use `|` to mark the cursor location; the helper strips
// it from the input, remembers the offset, runs applyListIndent, and returns
// the rewritten content and the cursor position expressed the same way.
function runIndent(input: string, direction: 'indent' | 'outdent') {
    const cursor = input.indexOf('|');
    if (cursor < 0) throw new Error('fixture must contain a `|` cursor marker');
    const stripped = input.slice(0, cursor) + input.slice(cursor + 1);
    const result = applyListIndent(stripped, cursor, direction);
    if (!result) return null;
    const withCursor =
        result.content.slice(0, result.cursor) +
        '|' +
        result.content.slice(result.cursor);
    return withCursor;
}

describe('applyListIndent — numbered lists (the primary regression)', () => {
    it('indents an item in the middle of a numeric list and renumbers around it', () => {
        // The exact case in issue #30: pressing Tab on `2. two` should leave
        // it as `1. two` at the deeper level, and `3. three` should renumber
        // to `2. three` at the outer level.
        const out = runIndent('1. one\n2. |two\n3. three', 'indent');
        expect(out).toBe('1. one\n  1. |two\n2. three');
    });

    it('outdents an item back and restores the outer sequence', () => {
        const out = runIndent('1. one\n  1. |two\n2. three', 'outdent');
        expect(out).toBe('1. one\n2. |two\n3. three');
    });

    it('renumbers when the item marker length changes on indent (10 → 1)', () => {
        // Prefix "10. " (4 chars) shrinks to "  1. " (5 chars) → cursor
        // shifts by +1, and the outer sequence closes so `11. eleven`
        // becomes `10. eleven`.
        const out = runIndent('9. nine\n10. |ten\n11. eleven', 'indent');
        expect(out).toBe('9. nine\n  1. |ten\n10. eleven');
    });

    it('is a no-op at the outermost level on outdent (returns null)', () => {
        const result = applyListIndent('1. one\n2. |two', 5, 'outdent');
        // Cursor 5 is in `1. one` at column 5. Outdenting there would go
        // negative and must absorb the event without mutating content.
        expect(result).toBeNull();
    });

    it('starts a fresh nested sequence at the new depth', () => {
        // Indenting an item that has no preceding sibling at the deeper depth
        // must start the counter at 1, not carry over from the outer marker.
        const out = runIndent('1. one\n2. |two', 'indent');
        expect(out).toBe('1. one\n  1. |two');
    });
});

describe('applyListIndent — bullet & task lists', () => {
    it('indents a bullet without touching its marker character', () => {
        const out = runIndent('- one\n- |two\n- three', 'indent');
        expect(out).toBe('- one\n  - |two\n- three');
    });

    it('indents a task list item preserving its checkbox state', () => {
        const out = runIndent('- [ ] first\n- [x] |done\n- [ ] later', 'indent');
        expect(out).toBe('- [ ] first\n  - [x] |done\n- [ ] later');
    });

    it('outdents a bullet back to column 0', () => {
        const out = runIndent('- one\n  - |two\n- three', 'outdent');
        expect(out).toBe('- one\n- |two\n- three');
    });
});

describe('applyListIndent — non-list lines', () => {
    it('returns null when the cursor is not inside a list item', () => {
        expect(applyListIndent('just a paragraph', 5, 'indent')).toBeNull();
        expect(applyListIndent('just a paragraph', 5, 'outdent')).toBeNull();
    });
});

describe('applyListIndent — nested list renumbering', () => {
    it('resets the deep counter when re-entering the outer level', () => {
        // Two separate sub-lists at depth 2 under different parents each start
        // at 1 rather than continuing across the parent boundary.
        const input =
            '1. one\n  1. sub-a\n  2. |sub-b\n2. two\n  1. sub-c';
        const out = runIndent(input, 'outdent');
        // sub-b comes out of the nested list; the depth-2 counter for sub-a's
        // group closes, and sub-c starts a fresh depth-2 sequence at 1.
        expect(out).toBe(
            '1. one\n  1. sub-a\n2. |sub-b\n3. two\n  1. sub-c',
        );
    });
});
