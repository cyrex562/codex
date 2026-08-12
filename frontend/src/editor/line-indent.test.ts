import { describe, it, expect } from 'vitest';
import { applyLineIndent } from './line-indent';

// Same `|`-cursor-marker convention as list-indent.test.ts. For a selection,
// use `[` and `]` to mark start/end instead of `|`.
function runCaret(input: string, direction: 'indent' | 'outdent') {
    const cursor = input.indexOf('|');
    if (cursor < 0) throw new Error('fixture must contain a `|` cursor marker');
    const stripped = input.slice(0, cursor) + input.slice(cursor + 1);
    const result = applyLineIndent(stripped, cursor, cursor, direction);
    if (!result) return null;
    return (
        result.content.slice(0, result.selectionStart) +
        '|' +
        result.content.slice(result.selectionStart)
    );
}

function runSelection(input: string, direction: 'indent' | 'outdent') {
    const start = input.indexOf('[');
    const end = input.indexOf(']') - 1; // account for the removed '[' already shifting indices
    if (start < 0 || input.indexOf(']') < 0) {
        throw new Error('fixture must contain `[` and `]` selection markers');
    }
    const stripped = input.replace('[', '').replace(']', '');
    const result = applyLineIndent(stripped, start, end, direction);
    if (!result) return null;
    return (
        result.content.slice(0, result.selectionStart) +
        '[' +
        result.content.slice(result.selectionStart, result.selectionEnd) +
        ']' +
        result.content.slice(result.selectionEnd)
    );
}

describe('applyLineIndent — single caret on a list line delegates to applyListIndent', () => {
    it('indents an ordered list item and renumbers, same as applyListIndent directly', () => {
        const out = runCaret('1. one\n2. |two\n3. three', 'indent');
        expect(out).toBe('1. one\n  1. |two\n2. three');
    });

    it('outdents a bullet back to column 0', () => {
        const out = runCaret('- one\n  - |two\n- three', 'outdent');
        expect(out).toBe('- one\n- |two\n- three');
    });

    it('falls back to the generic path when applyListIndent refuses (top-level outdent)', () => {
        // Plain applyListIndent returns null here (would go negative); the
        // generic path also has nothing to strip (no leading whitespace) —
        // overall still a no-op, but it goes through the fallback branch.
        const out = runCaret('1. one\n2. |two', 'outdent');
        expect(out).toBeNull();
    });
});

describe('applyLineIndent — generic single-line indent/dedent (paragraphs, headings, code)', () => {
    it('indents a plain paragraph line from column 0, regardless of caret position', () => {
        const out = runCaret('hel|lo world', 'indent');
        expect(out).toBe('  hel|lo world');
    });

    it('dedents a line with 2 leading spaces back to column 0', () => {
        const out = runCaret('  hel|lo', 'outdent');
        expect(out).toBe('hel|lo');
    });

    it('dedents a line with only 1 leading space (clamped, not negative)', () => {
        const out = runCaret(' hel|lo', 'outdent');
        expect(out).toBe('hel|lo');
    });

    it('returns null outdenting a line with no leading whitespace', () => {
        expect(applyLineIndent('hello', 2, 2, 'outdent')).toBeNull();
    });

    it('indents a heading line', () => {
        const out = runCaret('## Hea|ding', 'indent');
        expect(out).toBe('  ## Hea|ding');
    });
});

describe('applyLineIndent — multi-line selection', () => {
    it('indents every line touched by the selection', () => {
        // The selection boundary sits exactly at the insertion point (start
        // of line 0), so — consistent with every other cursor-math helper in
        // this codebase (e.g. markdown-toolbar.ts's applyLinePrefix) — it
        // shifts forward past the newly-inserted indent, same as any other
        // absolute position before which text was inserted.
        const out = runSelection('[alpha\nbeta\ngamma]', 'indent');
        expect(out).toBe('  [alpha\n  beta\n  gamma]');
    });

    it('dedents every line touched by the selection', () => {
        const out = runSelection('[  alpha\n  beta\n  gamma]', 'outdent');
        expect(out).toBe('[alpha\nbeta\ngamma]');
    });

    it('only dedents lines that actually have leading whitespace, leaving others untouched', () => {
        const out = runSelection('[  alpha\nbeta\n  gamma]', 'outdent');
        expect(out).toBe('[alpha\nbeta\ngamma]');
    });

    it('returns null when outdenting a selection with no leading whitespace anywhere', () => {
        const start = 0;
        const end = 'alpha\nbeta'.length;
        expect(applyLineIndent('alpha\nbeta', start, end, 'outdent')).toBeNull();
    });
});
