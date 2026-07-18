// Pure logic behind Tab / Shift-Tab inside a list item.
//
// The visible bug this fixes: pressing Tab inside an ordered list would just
// prepend two spaces of indent, leaving the item's number unchanged. Indenting
// the second item of `1./2./3.` produced `1./  2./3.`, an obviously wrong
// display. Correct behavior is to re-derive the marker from the new depth and
// close the gap in the sequence the item left behind at the old depth.
//
// This module is pure so it can be exercised by Vitest without pulling in the
// full editor Vue component. `MarkdownEditor.vue` calls `applyListIndent` from
// its Tab handler.

const INDENT = 2;

type OrderedStyle =
  | 'numeric'
  | 'alpha-lower'
  | 'alpha-upper'
  | 'roman-lower'
  | 'roman-upper';

type LineKind = 'ordered' | 'bullet' | 'task' | 'other';

interface Parsed {
  kind: LineKind;
  indent: number;
  /** Raw marker text (e.g. "3", "iv", "-", "*", "+"). */
  markerRaw?: string;
  /** For bullet/task lists: the bullet character. */
  markerChar?: string;
  /** For task lists: the checkbox state character. */
  taskState?: string;
  orderedStyle?: OrderedStyle;
  /** Length of the full prefix including trailing space. */
  prefixLen: number;
  content: string;
}

function parseLine(line: string): Parsed {
  // Task list marker: `- [ ] `, `* [x] `, etc. Check before bullet so a task
  // isn't misclassified as a plain bullet.
  const task = line.match(/^( *)([-*+]) \[([ xX])\] (.*)$/);
  if (task) {
    const indent = task[1].length;
    return {
      kind: 'task',
      indent,
      markerChar: task[2],
      taskState: task[3],
      prefixLen: indent + 6,
      content: task[4],
    };
  }
  const bullet = line.match(/^( *)([-*+]) (.*)$/);
  if (bullet) {
    const indent = bullet[1].length;
    return {
      kind: 'bullet',
      indent,
      markerChar: bullet[2],
      prefixLen: indent + 2,
      content: bullet[3],
    };
  }
  // Ordered: `\d+.`, `a.`/`A.`, `iv.`/`IV.`. The regex order matters: numeric
  // is unambiguous; then roman (multi-char, must beat single-char alpha for
  // strings like "iv"); then single-char alpha as the fallback.
  const ordered = line.match(
    /^( *)(\d+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])\. (.*)$/,
  );
  if (ordered) {
    const indent = ordered[1].length;
    const raw = ordered[2];
    let style: OrderedStyle;
    if (/^\d+$/.test(raw)) style = 'numeric';
    else if (/^[ivxlcdm]+$/.test(raw)) style = 'roman-lower';
    else if (/^[IVXLCDM]+$/.test(raw)) style = 'roman-upper';
    else if (/^[a-z]$/.test(raw)) style = 'alpha-lower';
    else style = 'alpha-upper';
    return {
      kind: 'ordered',
      indent,
      markerRaw: raw,
      orderedStyle: style,
      prefixLen: indent + raw.length + 2,
      content: ordered[3],
    };
  }
  return {
    kind: 'other',
    indent: line.match(/^ */)?.[0].length ?? 0,
    prefixLen: 0,
    content: line,
  };
}

function intToRomanLower(n: number): string {
  if (n <= 0) return 'i';
  const units: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  let remaining = n;
  for (const [v, s] of units) {
    while (remaining >= v) {
      out += s;
      remaining -= v;
    }
  }
  return out;
}

function renderOrderedMarker(style: OrderedStyle, n: number): string {
  if (style === 'numeric') return String(n);
  if (style === 'alpha-lower') return String.fromCharCode(97 + ((n - 1) % 26));
  if (style === 'alpha-upper') return String.fromCharCode(65 + ((n - 1) % 26));
  if (style === 'roman-lower') return intToRomanLower(n);
  return intToRomanLower(n).toUpperCase();
}

function romanLowerToInt(s: string): number {
  const map: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]] ?? 0;
    const next = map[s[i + 1]] ?? 0;
    if (cur < next) total -= cur;
    else total += cur;
  }
  return total || 1;
}

function orderedMarkerToInt(style: OrderedStyle, raw: string): number {
  if (style === 'numeric') return parseInt(raw, 10);
  if (style === 'alpha-lower') return raw.charCodeAt(0) - 96;
  if (style === 'alpha-upper') return raw.charCodeAt(0) - 64;
  if (style === 'roman-lower') return romanLowerToInt(raw);
  return romanLowerToInt(raw.toLowerCase());
}

function startOfSequenceMarker(style: OrderedStyle): string {
  if (style === 'numeric') return '1';
  if (style === 'alpha-lower') return 'a';
  if (style === 'alpha-upper') return 'A';
  if (style === 'roman-lower') return 'i';
  return 'I';
}

function renderPrefix(p: Parsed, orderedValue?: number): string {
  const pad = ' '.repeat(p.indent);
  if (p.kind === 'task') return `${pad}${p.markerChar} [${p.taskState}] `;
  if (p.kind === 'bullet') return `${pad}${p.markerChar} `;
  if (p.kind === 'ordered') {
    const marker = renderOrderedMarker(p.orderedStyle!, orderedValue ?? 1);
    return `${pad}${marker}. `;
  }
  return pad;
}

function isListLine(line: string): boolean {
  return /^ *([-*+]|(\d+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])\.) /.test(line);
}

export interface ApplyListIndentResult {
  content: string;
  cursor: number;
}

/**
 * Apply Tab / Shift-Tab to the list item containing `cursor`.
 *
 * On success returns the rewritten document plus the new cursor position.
 * Returns `null` when the cursor isn't inside a list item, or when Shift-Tab
 * is invoked at the outermost level (caller then absorbs the event as a
 * no-op, matching the previous handler's contract).
 *
 * Ordered lists (numeric, alpha, roman) are re-derived from a depth-keyed
 * counter so the current line picks up the correct value at its new depth
 * and the surrounding sequence closes the gap it just left behind. Bullet
 * and task lists only have their indent adjusted; their state is preserved.
 */
export function applyListIndent(
  content: string,
  cursor: number,
  direction: 'indent' | 'outdent',
): ApplyListIndentResult | null {
  const lines = content.split('\n');

  let lineStart = 0;
  let lineIdx = 0;
  while (
    lineIdx < lines.length &&
    lineStart + lines[lineIdx].length < cursor
  ) {
    lineStart += lines[lineIdx].length + 1;
    lineIdx++;
  }
  if (lineIdx >= lines.length) return null;

  const oldLine = lines[lineIdx];
  const parsed = parseLine(oldLine);
  if (parsed.kind === 'other') return null;

  const newIndent =
    direction === 'indent' ? parsed.indent + INDENT : parsed.indent - INDENT;
  if (newIndent < 0) return null;

  // Rewrite the target line's leading whitespace in place. For ordered items
  // we also collapse the marker to the natural start-of-sequence value at the
  // new depth (`1.`, `a.`, `i.`, …) so the block walker's per-depth counter
  // initialises from `1`. Other items in the block still keep their existing
  // markers — the walker seeds `counters[depth]` from the first item's raw
  // value so custom starting numbers (e.g. `9. nine, 10. ten, …`) survive.
  const targetWithoutIndent = oldLine.replace(/^ */, '');
  const targetRebased =
    parsed.kind === 'ordered'
      ? targetWithoutIndent.replace(
          /^(\S+)\./,
          `${startOfSequenceMarker(parsed.orderedStyle!)}.`,
        )
      : targetWithoutIndent;
  lines[lineIdx] = ' '.repeat(newIndent) + targetRebased;

  // Grow the list block outward while adjacent lines still look like list
  // items. A blank line or a plain paragraph closes the block, matching
  // Obsidian's rendering behavior.
  let blockStart = lineIdx;
  while (blockStart > 0 && isListLine(lines[blockStart - 1])) blockStart--;
  let blockEnd = lineIdx;
  while (
    blockEnd < lines.length - 1 &&
    isListLine(lines[blockEnd + 1])
  ) {
    blockEnd++;
  }

  // Walk the block top-down maintaining a per-depth counter. Deeper counters
  // are discarded whenever the depth drops so a fresh nested list restarts
  // its numbering from 1. A bullet/task at depth D resets the numeric counter
  // at D so a following numeric item at the same depth begins a new sequence.
  const counters: Record<number, number> = {};
  const newBlockLines: string[] = [];
  for (let i = blockStart; i <= blockEnd; i++) {
    const p = parseLine(lines[i]);
    for (const dstr of Object.keys(counters)) {
      const d = Number(dstr);
      if (d > p.indent) delete counters[d];
    }
    if (p.kind === 'ordered' && p.orderedStyle) {
      if (counters[p.indent] === undefined) {
        // First item at this depth in a fresh sibling group — honor its raw
        // starting value (e.g. `9. nine` starts the outer counter at 9).
        counters[p.indent] = orderedMarkerToInt(p.orderedStyle, p.markerRaw!);
      } else {
        counters[p.indent] += 1;
      }
      newBlockLines.push(renderPrefix(p, counters[p.indent]) + p.content);
    } else {
      newBlockLines.push(lines[i]);
      counters[p.indent] = 0;
    }
  }

  const rebuiltLines = [
    ...lines.slice(0, blockStart),
    ...newBlockLines,
    ...lines.slice(blockEnd + 1),
  ];
  const rebuilt = rebuiltLines.join('\n');

  // Cursor: sum of length deltas for renumbered lines before the target, plus
  // the target line's own prefix-length delta. Content offset within the
  // target line is preserved.
  let priorShift = 0;
  for (let i = blockStart; i < lineIdx; i++) {
    priorShift += newBlockLines[i - blockStart].length - lines[i].length;
  }
  const oldPrefixLen = parseLine(oldLine).prefixLen;
  const newLine = newBlockLines[lineIdx - blockStart];
  const newPrefixLen = parseLine(newLine).prefixLen;
  const inLineOffset = cursor - lineStart;
  const contentOffset = Math.max(0, inLineOffset - oldPrefixLen);
  const newCursor = lineStart + priorShift + newPrefixLen + contentOffset;

  return { content: rebuilt, cursor: newCursor };
}
