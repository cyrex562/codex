// Pure logic for two heading-specific editor behaviors:
//  - typing the space that completes `#`/`##`/`###`... on an indented line
//    auto-dedents that line back to column 1 (headings never start indented)
//  - pressing Enter on a heading line starts the new line at column 1,
//    instead of CodeJar's default of carrying the current line's leading
//    whitespace onto the new one.
// Kept pure (no DOM) so both are unit-testable without mounting the editor —
// MarkdownEditor.vue's keydown handlers are thin wrappers around these.

export interface HeadingSpaceResult {
    content: string;
    cursor: number;
}

/**
 * If the text from the start of the current line up to `cursor` is purely
 * leading whitespace followed by 1-6 `#` characters (i.e. the caret sits
 * right after a heading marker that's about to be completed by the space the
 * caller is currently handling), strip that leading whitespace so the
 * heading lands at column 1. Returns null when the line doesn't match —
 * callers should let the space be typed normally in that case.
 */
export function applyHeadingSpaceDedent(content: string, cursor: number): HeadingSpaceResult | null {
    const lineStart = content.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const lineEndCandidate = content.indexOf('\n', cursor);
    const lineEnd = lineEndCandidate === -1 ? content.length : lineEndCandidate;
    const line = content.slice(lineStart, lineEnd);
    const beforeCursor = line.slice(0, cursor - lineStart);
    const afterCursor = line.slice(cursor - lineStart);

    const m = beforeCursor.match(/^(\s+)(#{1,6})$/);
    if (!m) return null;
    const hashes = m[2];

    const newLine = `${hashes} ${afterCursor}`;
    const newContent = content.slice(0, lineStart) + newLine + content.slice(lineEnd);
    const newCursor = lineStart + hashes.length + 1;
    return { content: newContent, cursor: newCursor };
}

export interface HeadingEnterResult {
    content: string;
    cursor: number;
}

/**
 * If `cursor` sits on a heading line, pressing Enter should start the new
 * line at column 1 rather than inherit the heading line's own indentation
 * (legacy indented headings, or a moment before applyHeadingSpaceDedent's
 * next keystroke would otherwise have stripped it). Returns null when the
 * current line isn't a heading — callers fall through to default Enter
 * handling in that case.
 */
export function applyHeadingEnter(content: string, cursor: number): HeadingEnterResult | null {
    const lineStart = content.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const lineEndCandidate = content.indexOf('\n', cursor);
    const lineEnd = lineEndCandidate === -1 ? content.length : lineEndCandidate;
    const line = content.slice(lineStart, lineEnd);
    if (!/^\s*#{1,6}\s/.test(line)) return null;

    const newContent = content.slice(0, cursor) + '\n' + content.slice(cursor);
    return { content: newContent, cursor: cursor + 1 };
}
