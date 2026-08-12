// Pure logic for generic (non-list) line indent/dedent — Tab/Shift-Tab and
// the toolbar's increase/decrease-indent buttons, for lines that aren't list
// items (paragraphs, headings, code blocks) or that span a multi-line
// selection. List-item indent/dedent (with ordered-list renumbering) is
// handled separately by applyListIndent in list-indent.ts; applyLineIndent
// delegates to it for the single-caret-on-a-list-line case so callers get one
// function that does the right thing everywhere.

import { applyListIndent } from './list-indent';

const INDENT = '  '; // 2 spaces — matches list-indent.ts's INDENT and CodeJar's { tab: '  ' }

export interface LineIndentResult {
    content: string;
    selectionStart: number;
    selectionEnd: number;
}

function isListLine(line: string): boolean {
    return /^\s*([-*+]|(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)\.)\s/.test(line);
}

/**
 * Indent or dedent every line touched by [start, end] by one 2-space unit,
 * anchored at column 0 regardless of where the caret sits within a line.
 * Returns null when nothing changes (e.g. outdent where no touched line has
 * any leading whitespace to remove).
 */
function applyGenericIndent(
    content: string,
    start: number,
    end: number,
    direction: 'indent' | 'outdent',
): LineIndentResult | null {
    const firstLineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lastLineEndCandidate = content.indexOf('\n', end);
    const lastLineEnd = lastLineEndCandidate === -1 ? content.length : lastLineEndCandidate;

    const before = content.slice(0, firstLineStart);
    const segment = content.slice(firstLineStart, lastLineEnd);
    const after = content.slice(lastLineEnd);

    const lines = segment.split('\n');
    let startDelta = 0;
    let totalDelta = 0;
    let changed = false;

    const newLines = lines.map((line, i) => {
        if (direction === 'indent') {
            totalDelta += INDENT.length;
            if (i === 0) startDelta += INDENT.length;
            changed = true;
            return INDENT + line;
        }
        const leading = line.match(/^ */)?.[0].length ?? 0;
        const removeLen = Math.min(INDENT.length, leading);
        if (removeLen === 0) return line;
        changed = true;
        totalDelta -= removeLen;
        if (i === 0) startDelta -= removeLen;
        return line.slice(removeLen);
    });

    if (!changed) return null;

    const newSegment = newLines.join('\n');
    const newContent = before + newSegment + after;
    const newStart = Math.max(firstLineStart, start + startDelta);
    const newEnd = Math.max(newStart, end + totalDelta);

    return { content: newContent, selectionStart: newStart, selectionEnd: newEnd };
}

/**
 * Indent or dedent the current line/selection. For a single caret sitting on
 * a list item, delegates to applyListIndent (ordered-list-aware, preserves
 * renumbering). Otherwise applies a generic per-line 2-space indent/dedent —
 * covers plain paragraphs, headings, code blocks, and multi-line selections
 * of any content (including ones that mix list and non-list lines, which
 * applyListIndent's per-block renumbering isn't designed to handle).
 *
 * Returns null when there is nothing to do (outdent with no leading
 * whitespace anywhere in the touched lines).
 */
export function applyLineIndent(
    content: string,
    start: number,
    end: number,
    direction: 'indent' | 'outdent',
): LineIndentResult | null {
    if (start === end) {
        const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const lineEndCandidate = content.indexOf('\n', start);
        const lineEnd = lineEndCandidate === -1 ? content.length : lineEndCandidate;
        const line = content.slice(lineStart, lineEnd);
        if (isListLine(line)) {
            const result = applyListIndent(content, start, direction);
            if (result) {
                return { content: result.content, selectionStart: result.cursor, selectionEnd: result.cursor };
            }
            // applyListIndent returned null (e.g. outdent already at column 0)
            // — fall through to the generic path instead of doing nothing.
        }
    }
    return applyGenericIndent(content, start, end, direction);
}
