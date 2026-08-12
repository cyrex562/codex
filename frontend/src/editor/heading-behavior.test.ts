import { describe, it, expect } from 'vitest';
import { applyHeadingSpaceDedent, applyHeadingEnter } from './heading-behavior';

// `|` marks the cursor, same convention as list-indent.test.ts.
function runSpace(input: string) {
    const cursor = input.indexOf('|');
    if (cursor < 0) throw new Error('fixture must contain a `|` cursor marker');
    const stripped = input.slice(0, cursor) + input.slice(cursor + 1);
    const result = applyHeadingSpaceDedent(stripped, cursor);
    if (!result) return null;
    return result.content.slice(0, result.cursor) + '|' + result.content.slice(result.cursor);
}

function runEnter(input: string) {
    const cursor = input.indexOf('|');
    if (cursor < 0) throw new Error('fixture must contain a `|` cursor marker');
    const stripped = input.slice(0, cursor) + input.slice(cursor + 1);
    const result = applyHeadingEnter(stripped, cursor);
    if (!result) return null;
    return result.content.slice(0, result.cursor) + '|' + result.content.slice(result.cursor);
}

describe('applyHeadingSpaceDedent', () => {
    it('dedents an indented "#" to column 1 when the completing space is typed', () => {
        const out = runSpace('  #|');
        expect(out).toBe('# |');
    });

    it('dedents an indented "###" preserving the hash count', () => {
        const out = runSpace('    ###|');
        expect(out).toBe('### |');
    });

    it('preserves text already following the cursor on the line', () => {
        const out = runSpace('  ##|existing text');
        expect(out).toBe('## |existing text');
    });

    it('is a no-op (returns null) when there is no leading whitespace to strip', () => {
        expect(applyHeadingSpaceDedent('#', 1)).toBeNull();
    });

    it('is a no-op when the text before the cursor is not purely whitespace + hashes', () => {
        expect(applyHeadingSpaceDedent('  # x', 5)).toBeNull();
        expect(applyHeadingSpaceDedent('  a#', 4)).toBeNull();
    });

    it('is a no-op when there are no hashes at all', () => {
        expect(applyHeadingSpaceDedent('   ', 3)).toBeNull();
    });
});

describe('applyHeadingEnter', () => {
    it('starts the new line at column 1 after an indented heading', () => {
        const out = runEnter('  ## Heading|');
        expect(out).toBe('  ## Heading\n|');
    });

    it('starts the new line at column 1 splitting a heading mid-text', () => {
        const out = runEnter('## Hea|ding');
        expect(out).toBe('## Hea\n|ding');
    });

    it('is a no-op (returns null) on a non-heading line', () => {
        expect(applyHeadingEnter('just a paragraph|', 16)).toBeNull();
    });

    it('is a no-op on a list line, even though it starts with a non-heading marker', () => {
        expect(applyHeadingEnter('- item', 3)).toBeNull();
    });
});
