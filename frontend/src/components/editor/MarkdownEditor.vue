<template>
  <div class="markdown-editor-shell">
    <div ref="editorEl" class="markdown-editor" :class="{ 'is-formatted-mode': mode === 'formatted_raw' }" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useUndoRedo } from '@/composables/useUndoRedo';
import { renderFormattedMarkdown, highlightPlainText } from '@/utils/highlight';
import { applyMarkdownToolbarCommand, type MarkdownToolbarCommand } from '@/editor/markdown-toolbar';
import { ApiError } from '@/api/client';
import { useVaultsStore } from '@/stores/vaults';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import type { EditorMode } from '@/api/types';

const foldStateByNoteKey = new Map<string, Set<number>>();

const props = defineProps<{
  tabId: string;
  content: string;
  filePath?: string;
  mode: EditorMode;
}>();

const emit = defineEmits<{ update: [value: string] }>();

const editorEl = ref<HTMLElement | null>(null);
let jar: any = null;
let ignoreNextChange = false;
let availableFoldStarts = new Set<number>();
let collapsedFoldStarts = new Set<number>();
const vaultsStore = useVaultsStore();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();

const { recordChange, undo, redo } = useUndoRedo(props.tabId) as any;

function currentNoteFoldKey(): string {
  return props.filePath ? `path:${props.filePath.toLowerCase()}` : `tab:${props.tabId}`;
}

function loadFoldStateForCurrentNote() {
  collapsedFoldStarts = new Set(foldStateByNoteKey.get(currentNoteFoldKey()) ?? []);
}

function persistFoldStateForCurrentNote() {
  const key = currentNoteFoldKey();
  if (collapsedFoldStarts.size === 0) {
    foldStateByNoteKey.delete(key);
    return;
  }
  foldStateByNoteKey.set(key, new Set(collapsedFoldStarts));
}

function highlightForCurrentMode(editor: HTMLElement) {
  if (props.mode === 'raw') {
    availableFoldStarts = new Set();
    highlightPlainText(editor);
    return;
  }

  const result = renderFormattedMarkdown(editor.textContent ?? '', collapsedFoldStarts);
  availableFoldStarts = new Set(result.foldRegions.map((region) => region.startLine));
  collapsedFoldStarts = new Set([...collapsedFoldStarts].filter((startLine) => availableFoldStarts.has(startLine)));
  persistFoldStateForCurrentNote();

  if (editor.innerHTML !== result.html) {
    editor.innerHTML = result.html;
  }
}

function rerenderWithoutChangingContent() {
  if (!editorEl.value) return;
  const { start, end } = getSelectionOffsets(editorEl.value);
  highlightForCurrentMode(editorEl.value);
  requestAnimationFrame(() => {
    if (!editorEl.value) return;
    setSelectionOffsets(editorEl.value, start, end);
  });
}

function onEditorClick(event: MouseEvent) {
  if (props.mode !== 'formatted_raw' || !editorEl.value) return;
  const target = event.target as HTMLElement | null;
  const toggle = target?.closest('.editor-md-fold-toggle') as HTMLElement | null;
  if (!toggle) return;

  event.preventDefault();
  event.stopPropagation();

  const startLine = Number(toggle.dataset.foldStart);
  if (!Number.isFinite(startLine) || !availableFoldStarts.has(startLine)) return;

  const next = new Set(collapsedFoldStarts);
  if (next.has(startLine)) next.delete(startLine);
  else next.add(startLine);
  collapsedFoldStarts = next;
  persistFoldStateForCurrentNote();
  rerenderWithoutChangingContent();
}

function collapseAllFolds() {
  if (props.mode !== 'formatted_raw') return;
  if (availableFoldStarts.size === 0) return;
  collapsedFoldStarts = new Set(availableFoldStarts);
  persistFoldStateForCurrentNote();
  rerenderWithoutChangingContent();
}

function expandAllFolds() {
  if (collapsedFoldStarts.size === 0) return;
  collapsedFoldStarts = new Set();
  persistFoldStateForCurrentNote();
  rerenderWithoutChangingContent();
}

onMounted(async () => {
  if (!editorEl.value) return;
  loadFoldStateForCurrentNote();
  // CodeJar is a ~1kB editor; loaded dynamically from vendor dir or npm
  const { CodeJar } = await import('codejar');
  jar = CodeJar(editorEl.value, highlightForCurrentMode, { tab: '  ' });
  jar.updateCode(props.content);
  jar.onUpdate((code: string) => {
    if (ignoreNextChange) { ignoreNextChange = false; return; }
    recordChange(code);
    emit('update', code);
  });

  editorEl.value.addEventListener('keydown', onKeydown, true);
  editorEl.value.addEventListener('click', onEditorClick, true);
});

onUnmounted(() => {
  editorEl.value?.removeEventListener('keydown', onKeydown, true);
  editorEl.value?.removeEventListener('click', onEditorClick, true);
  jar = null;
});

// Sync external content changes (e.g. WS reload) without double-emitting
watch(() => props.content, (newVal) => {
  if (!jar) return;
  if (jar.toString() !== newVal) {
    ignoreNextChange = true;
    jar.updateCode(newVal);
  }
});

watch(() => props.mode, () => {
  if (!jar) return;
  jar.updateCode(jar.toString());
});

watch(() => [props.tabId, props.filePath], () => {
  availableFoldStarts = new Set();
  loadFoldStateForCurrentNote();
  rerenderWithoutChangingContent();
});

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const prev = undo();
    if (prev != null && prev !== jar?.toString()) {
      ignoreNextChange = true;
      jar?.updateCode(prev);
      emit('update', prev);
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const next = redo();
    if (next != null && next !== jar?.toString()) {
      ignoreNextChange = true;
      jar?.updateCode(next);
      emit('update', next);
    }
    return;
  }

  // Automatic List Management
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (handleTableEnter(e)) return;
    if (handleListEnter(e)) return;
  }

  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (handleTableTab(e, e.shiftKey)) return;
    if (handleListTab(e, e.shiftKey)) return;
  }
}

// ── Automatic List Management ─────────────────────────────────────────────────

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const pipeCount = [...line].filter((ch) => ch === '|').length;
  return pipeCount >= 2;
}

function isTableDividerLine(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function tableColumnCount(line: string): number {
  const seps = getPipeIndices(line);
  return Math.max(0, seps.length - 1);
}

function getPipeIndices(line: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '|') indices.push(i);
  }
  return indices;
}

function getCellBounds(line: string, colIndex: number): { start: number; end: number } | null {
  const seps = getPipeIndices(line);
  if (seps.length < 2 || colIndex < 0 || colIndex >= seps.length - 1) return null;
  const rawStart = seps[colIndex] + 1;
  const rawEnd = seps[colIndex + 1];
  let start = rawStart;
  let end = rawEnd;
  while (start < end && line[start] === ' ') start += 1;
  while (end > start && line[end - 1] === ' ') end -= 1;
  if (start >= end) {
    start = Math.min(rawStart + 1, rawEnd);
    end = start;
  }
  return { start, end };
}

function currentTableColumnIndex(line: string, cursorInLine: number): number {
  const seps = getPipeIndices(line);
  for (let i = 0; i < seps.length - 1; i += 1) {
    if (cursorInLine <= seps[i + 1]) return i;
  }
  return Math.max(0, seps.length - 2);
}

function makeBlankTableRowFrom(line: string): string {
  const indent = (line.match(/^(\s*)/)?.[1] ?? '');
  const cols = Math.max(1, tableColumnCount(line));
  return `${indent}| ${Array(cols).fill('').join(' | ')} |`;
}

function rowCellAbsoluteSelection(row: string, lineStartAbsolute: number, colIndex: number): { start: number; end: number } {
  const bounds = getCellBounds(row, colIndex) ?? { start: 0, end: 0 };
  return {
    start: lineStartAbsolute + bounds.start,
    end: lineStartAbsolute + bounds.end,
  };
}

function handleTableEnter(e: KeyboardEvent): boolean {
  if (!jar || !editorEl.value) return false;
  const content = jar.toString() as string;
  const { start, end } = getSelectionOffsets(editorEl.value);
  if (start !== end) return false;

  const { lineStart, lineEnd, line } = getLineRange(content, start);
  if (!isTableLine(line) || isTableDividerLine(line)) return false;

  e.preventDefault();
  e.stopImmediatePropagation();

  const newRow = makeBlankTableRowFrom(line);
  const insertionPoint = lineEnd;
  const newContent = `${content.slice(0, insertionPoint)}\n${newRow}${content.slice(insertionPoint)}`;

  const newRowStart = insertionPoint + 1;
  const nextSel = rowCellAbsoluteSelection(newRow, newRowStart, 0);

  recordChange(newContent);
  ignoreNextChange = true;
  jar.updateCode(newContent);
  emit('update', newContent);

  requestAnimationFrame(() => {
    if (!editorEl.value) return;
    setSelectionOffsets(editorEl.value, nextSel.start, nextSel.end);
    editorEl.value.focus();
  });

  return true;
}

function handleTableTab(e: KeyboardEvent, reverse: boolean): boolean {
  if (!jar || !editorEl.value) return false;
  const content = jar.toString() as string;
  const { start, end } = getSelectionOffsets(editorEl.value);
  if (start !== end) return false;

  const { lineStart, lineEnd, line } = getLineRange(content, start);
  if (!isTableLine(line)) return false;

  e.preventDefault();
  e.stopImmediatePropagation();

  const cursorInLine = start - lineStart;
  const colCount = Math.max(1, tableColumnCount(line));
  const currentCol = currentTableColumnIndex(line, cursorInLine);

  const jumpTo = (absStart: number, absEnd: number) => {
    requestAnimationFrame(() => {
      if (!editorEl.value) return;
      setSelectionOffsets(editorEl.value, absStart, absEnd);
      editorEl.value.focus();
    });
  };

  if (reverse) {
    if (currentCol > 0) {
      const bounds = rowCellAbsoluteSelection(line, lineStart, currentCol - 1);
      jumpTo(bounds.start, bounds.end);
      return true;
    }

    if (lineStart === 0) return true;
    const prevLineEnd = lineStart - 1;
    const prevMeta = getLineRange(content, prevLineEnd);
    if (!isTableLine(prevMeta.line) || isTableDividerLine(prevMeta.line)) return true;
    const prevCols = Math.max(1, tableColumnCount(prevMeta.line));
    const target = rowCellAbsoluteSelection(prevMeta.line, prevMeta.lineStart, prevCols - 1);
    jumpTo(target.start, target.end);
    return true;
  }

  if (currentCol < colCount - 1) {
    const bounds = rowCellAbsoluteSelection(line, lineStart, currentCol + 1);
    jumpTo(bounds.start, bounds.end);
    return true;
  }

  if (lineEnd < content.length) {
    const nextMeta = getLineRange(content, lineEnd + 1);
    if (isTableLine(nextMeta.line) && !isTableDividerLine(nextMeta.line)) {
      const target = rowCellAbsoluteSelection(nextMeta.line, nextMeta.lineStart, 0);
      jumpTo(target.start, target.end);
      return true;
    }
  }

  const newRow = makeBlankTableRowFrom(line);
  const insertionPoint = lineEnd;
  const newContent = `${content.slice(0, insertionPoint)}\n${newRow}${content.slice(insertionPoint)}`;
  const newRowStart = insertionPoint + 1;
  const target = rowCellAbsoluteSelection(newRow, newRowStart, 0);

  recordChange(newContent);
  ignoreNextChange = true;
  jar.updateCode(newContent);
  emit('update', newContent);
  jumpTo(target.start, target.end);
  return true;
}

function getLineRange(content: string, cursorPos: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = content.lastIndexOf('\n', cursorPos - 1) + 1;
  const nlPos = content.indexOf('\n', cursorPos);
  const lineEnd = nlPos === -1 ? content.length : nlPos;
  return { lineStart, lineEnd, line: content.slice(lineStart, lineEnd) };
}

function romanToInt(marker: string): number | null {
  const s = marker.toUpperCase();
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cur = values[s[i]];
    const next = i + 1 < s.length ? values[s[i + 1]] : 0;
    if (!cur) return null;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

function intToRoman(n: number): string {
  const map: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let value = Math.max(1, n);
  let out = '';
  for (const [unit, symbol] of map) {
    while (value >= unit) {
      out += symbol;
      value -= unit;
    }
  }
  return out;
}

function nextOrderedMarker(marker: string): string {
  if (/^\d+$/.test(marker)) return `${parseInt(marker, 10) + 1}`;
  if (/^[a-z]$/.test(marker)) return String.fromCharCode(((marker.charCodeAt(0) - 97 + 1) % 26) + 97);
  if (/^[A-Z]$/.test(marker)) return String.fromCharCode(((marker.charCodeAt(0) - 65 + 1) % 26) + 65);
  if (/^[ivxlcdm]+$/.test(marker)) {
    const num = romanToInt(marker);
    return num ? intToRoman(num + 1).toLowerCase() : 'i';
  }
  if (/^[IVXLCDM]+$/.test(marker)) {
    const num = romanToInt(marker);
    return num ? intToRoman(num + 1) : 'I';
  }
  return marker;
}

function handleListEnter(e: KeyboardEvent): boolean {
  if (!jar || !editorEl.value) return false;
  const content = jar.toString() as string;
  const { start, end } = getSelectionOffsets(editorEl.value);
  if (start !== end) return false;

  const { lineStart, lineEnd, line } = getLineRange(content, start);

  // Detect list type — task must be checked before bullet
  const taskM = line.match(/^(\s*)([-*+]) \[([ xX])\] (.*)/);
  const bulletM = !taskM ? line.match(/^(\s*)([-*+]) (.*)/) : null;
  const orderedM = !taskM && !bulletM ? line.match(/^(\s*)(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)\. (.*)/) : null;

  if (!taskM && !bulletM && !orderedM) return false;

  e.preventDefault();
  e.stopImmediatePropagation();

  let itemContent: string;
  let prefix: string;

  if (taskM) {
    itemContent = taskM[4];
    prefix = `${taskM[1]}${taskM[2]} [ ] `;
  } else if (bulletM) {
    itemContent = bulletM[3];
    prefix = `${bulletM[1]}${bulletM[2]} `;
  } else {
    itemContent = orderedM![3];
    const next = nextOrderedMarker(orderedM![2]);
    prefix = `${orderedM![1]}${next}. `;
  }

  let newContent: string;
  let newCursor: number;

  if (!itemContent) {
    // Empty list item → end the list; leave an empty line
    newContent = content.slice(0, lineStart) + content.slice(lineEnd);
    newCursor = lineStart;
  } else {
    // Continue the list with matching prefix
    newContent = content.slice(0, start) + '\n' + prefix + content.slice(start);
    newCursor = start + 1 + prefix.length;
  }

  recordChange(newContent);
  ignoreNextChange = true;
  jar.updateCode(newContent);
  emit('update', newContent);
  requestAnimationFrame(() => {
    if (!editorEl.value) return;
    setSelectionOffsets(editorEl.value, newCursor, newCursor);
    editorEl.value.focus();
  });
  return true;
}

function handleListTab(e: KeyboardEvent, dedent: boolean): boolean {
  if (!jar || !editorEl.value) return false;
  const content = jar.toString() as string;
  const { start, end } = getSelectionOffsets(editorEl.value);
  const { lineStart, lineEnd, line } = getLineRange(content, start);

  if (!line.match(/^\s*([-*+]|(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)\.) /)) return false;

  e.preventDefault();
  e.stopImmediatePropagation();

  let newLine: string;
  let delta: number;

  if (dedent) {
    if (line.startsWith('  ')) {
      newLine = line.slice(2);
      delta = -2;
    } else {
      return true; // at top level — absorb event
    }
  } else {
    newLine = '  ' + line;
    delta = 2;
  }

  const newContent = content.slice(0, lineStart) + newLine + content.slice(lineEnd);
  const newStart = Math.max(lineStart, start + delta);
  const newEnd = Math.max(lineStart, end + delta);

  recordChange(newContent);
  ignoreNextChange = true;
  jar.updateCode(newContent);
  emit('update', newContent);
  requestAnimationFrame(() => {
    if (!editorEl.value) return;
    setSelectionOffsets(editorEl.value, newStart, newEnd);
    editorEl.value.focus();
  });
  return true;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function basenameWithoutExt(path: string): string {
  return basename(path).replace(/\.md$/i, '');
}

function normalizeNoteFileName(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  const fallback = cleaned || 'Extracted Note';
  return /\.md$/i.test(fallback) ? fallback : `${fallback}.md`;
}

function extractCurrentHeadingSection(content: string, cursorPos: number): { start: number; end: number; text: string; title: string } | null {
  const lines = content.split('\n');
  const offsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    offsets.push(acc);
    acc += line.length + 1;
  }

  let cursorLine = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const lineStart = offsets[i];
    const lineEnd = lineStart + lines[i].length;
    if (cursorPos >= lineStart && cursorPos <= lineEnd + 1) {
      cursorLine = i;
      break;
    }
  }

  let headingLine = -1;
  let headingLevel = 0;
  for (let i = cursorLine; i >= 0; i -= 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      headingLine = i;
      headingLevel = m[1].length;
      break;
    }
  }
  if (headingLine === -1) return null;

  let endLine = lines.length;
  for (let i = headingLine + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m && m[1].length <= headingLevel) {
      endLine = i;
      break;
    }
  }

  const start = offsets[headingLine];
  const end = endLine < offsets.length ? offsets[endLine] - 1 : content.length;
  const text = content.slice(start, end).trim();
  const title = (lines[headingLine].match(/^(#{1,6})\s+(.+)$/)?.[2] ?? 'Extracted Note').trim();
  return { start, end, text, title };
}

async function extractSelectionToNote() {
  if (!jar || !editorEl.value) return;
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;

  const source = jar.toString() as string;
  let { start, end } = getSelectionOffsets(editorEl.value);
  let selected = source.slice(start, end).trim();
  let defaultNameHint = selected
    .split(/\r?\n/)[0]
    .replace(/[\[\]#*`>]/g, '')
    .trim()
    .slice(0, 60);

  if (start === end || !selected) {
    const section = extractCurrentHeadingSection(source, start);
    if (!section) {
      alert('Select text or place the cursor inside a heading section to extract.');
      return;
    }
    start = section.start;
    end = section.end;
    selected = section.text;
    defaultNameHint = section.title.slice(0, 60);
  }

  const defaultName = defaultNameHint || 'Extracted Note';

  const userName = prompt('New note file name', defaultName);
  if (userName == null) return;

  const fileName = normalizeNoteFileName(userName);
  const folder = props.filePath ? dirname(props.filePath) : '';
  const targetPath = folder ? `${folder}/${fileName}` : fileName;
  const targetWikilink = basenameWithoutExt(fileName);
  const currentWikilink = basenameWithoutExt(props.filePath ?? 'Current Note');
  const noteBody = `> Extracted from [[${currentWikilink}]]\n\n${selected}\n`;

  let noteExists = false;
  try {
    await filesStore.createFile(vaultId, targetPath, noteBody);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      noteExists = true;
    } else {
      throw error;
    }
  }

  const replacement = `[[${targetWikilink}]]`;
  const nextContent = `${source.slice(0, start)}${replacement}${source.slice(end)}`;

  recordChange(nextContent);
  ignoreNextChange = true;
  jar.updateCode(nextContent);
  emit('update', nextContent);

  const cursor = start + replacement.length;
  requestAnimationFrame(() => {
    if (!editorEl.value) return;
    setSelectionOffsets(editorEl.value, cursor, cursor);
    editorEl.value.focus();
  });

  tabsStore.openTab(tabsStore.activePaneId, targetPath, fileName);
  if (noteExists) {
    alert(`Note already existed. Linked to [[${targetWikilink}]].`);
  }
}

async function applyCommand(command: MarkdownToolbarCommand) {
  if (!jar || !editorEl.value) return;

  if (command === 'extract_to_note') {
    await extractSelectionToNote();
    return;
  }

  const source = jar.toString() as string;
  const { start, end } = getSelectionOffsets(editorEl.value);
  const result = applyMarkdownToolbarCommand(source, start, end, command);

  ignoreNextChange = true;
  jar.updateCode(result.content);
  emit('update', result.content);

  requestAnimationFrame(() => {
    if (!editorEl.value) return;
    setSelectionOffsets(editorEl.value, result.selectionStart, result.selectionEnd);
    editorEl.value.focus();
  });
}

function getSelectionOffsets(root: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    const len = jar?.toString()?.length ?? 0;
    return { start: len, end: len };
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    const len = jar?.toString()?.length ?? 0;
    return { start: len, end: len };
  }

  const preStart = range.cloneRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);

  return {
    start: preStart.toString().length,
    end: preEnd.toString().length,
  };
}

function setSelectionOffsets(root: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startNodeOffset = 0;
  let endNodeOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nextOffset = currentOffset + node.textContent!.length;

    if (!startNode && start <= nextOffset) {
      startNode = node;
      startNodeOffset = Math.max(0, start - currentOffset);
    }

    if (!endNode && end <= nextOffset) {
      endNode = node;
      endNodeOffset = Math.max(0, end - currentOffset);
      break;
    }

    currentOffset = nextOffset;
  }

  if (!startNode || !endNode) {
    root.focus();
    return;
  }

  const range = document.createRange();
  range.setStart(startNode, Math.min(startNodeOffset, startNode.length));
  range.setEnd(endNode, Math.min(endNodeOffset, endNode.length));
  selection.removeAllRanges();
  selection.addRange(range);
}

// ── Exposed API for EditorPane toolbar ───────────────────────────────────────

function callUndo() {
  const prev = undo();
  if (prev != null && prev !== jar?.toString()) {
    ignoreNextChange = true;
    jar?.updateCode(prev);
    emit('update', prev);
  }
}

function callRedo() {
  const next = redo();
  if (next != null && next !== jar?.toString()) {
    ignoreNextChange = true;
    jar?.updateCode(next);
    emit('update', next);
  }
}

defineExpose({ applyCommand, callUndo, callRedo, collapseAllFolds, expandAllFolds });
</script>

<style scoped>
.markdown-editor-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.markdown-editor {
  flex: 1;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.6;
  padding: 16px;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  overflow-y: auto;
  tab-size: 2;
  caret-color: rgb(var(--v-theme-primary));
}

.markdown-editor.is-formatted-mode {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 15px;
  line-height: 1.8;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-syntax) {
  color: rgba(var(--v-theme-on-background), 0.34);
}

.markdown-editor.is-formatted-mode :deep(.editor-md-line) {
  display: inline;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-line.is-hidden) {
  display: none;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-line.is-nested) {
  margin-left: calc(var(--fold-depth) * 4px);
  padding-left: calc(var(--fold-depth) * 6px);
  border-left: 1px solid rgba(var(--v-theme-primary), 0.18);
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-toggle),
.markdown-editor.is-formatted-mode :deep(.editor-md-fold-spacer) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25em;
  height: 1.25em;
  margin-right: 0.25em;
  color: rgba(var(--v-theme-on-background), 0.55);
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-toggle::before) {
  content: '▾';
  font-size: 0.92em;
  line-height: 1;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-toggle.is-collapsed::before) {
  content: '▸';
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-toggle) {
  cursor: pointer;
  border-radius: 0.25em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-toggle:hover) {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-summary) {
  display: inline-flex;
  align-items: center;
  margin-left: 0.5em;
  padding: 0.05em 0.45em;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.86em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fold-summary::before) {
  content: '… ' attr(data-hidden-lines) ' lines hidden';
}

.markdown-editor.is-formatted-mode :deep(.editor-md-heading) {
  color: rgb(var(--v-theme-on-background));
  font-weight: 700;
  display: inline-block;
  margin: 0.18em 0;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-heading-1) {
  font-size: 1.9em;
  letter-spacing: -0.02em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-heading-2) {
  font-size: 1.55em;
  letter-spacing: -0.015em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-heading-3) {
  font-size: 1.3em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-heading-4) {
  font-size: 1.15em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-heading-5),
.markdown-editor.is-formatted-mode :deep(.editor-md-heading-6) {
  font-size: 1.05em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-blockquote) {
  display: inline-block;
  padding: 0.05em 0 0.05em 0.9em;
  margin: 0.08em 0;
  border-left: 3px solid rgba(var(--v-theme-primary), 0.75);
  color: rgb(var(--v-theme-secondary));
  background: rgba(var(--v-theme-primary), 0.06);
}

.markdown-editor.is-formatted-mode :deep(.editor-md-blockquote-content) {
  font-style: italic;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-list-marker) {
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-checkbox) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4em;
  padding: 0 0.2em;
  border-radius: 0.35em;
  border: 1px solid rgba(var(--v-theme-on-background), 0.25);
  background: rgba(var(--v-theme-on-background), 0.06);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.9em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-checkbox.is-checked) {
  border-color: rgba(var(--v-theme-primary), 0.85);
  background: rgba(var(--v-theme-primary), 0.18);
  color: rgb(var(--v-theme-primary));
}

.markdown-editor.is-formatted-mode :deep(.editor-md-task-text) {
  color: rgb(var(--v-theme-on-background));
}

.markdown-editor.is-formatted-mode :deep(.editor-md-wikilink),
.markdown-editor.is-formatted-mode :deep(.editor-md-link) {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  border-radius: 0.4em;
  padding: 0.04em 0.28em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-tag) {
  color: #8dd3ff;
  background: rgba(141, 211, 255, 0.12);
  border: 1px solid rgba(141, 211, 255, 0.2);
  border-radius: 0.42em;
  padding: 0.03em 0.3em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-inline-code) {
  color: #f5d08a;
  background: rgba(245, 208, 138, 0.12);
  border: 1px solid rgba(245, 208, 138, 0.16);
  border-radius: 0.4em;
  padding: 0.06em 0.32em;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.92em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-strong) {
  color: rgb(var(--v-theme-on-background));
  font-weight: 700;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-emphasis) {
  color: rgb(var(--v-theme-on-background));
  font-style: italic;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-strikethrough) {
  color: rgb(var(--v-theme-secondary));
  text-decoration: line-through;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-highlight) {
  color: rgb(var(--v-theme-on-background));
  background: rgba(250, 204, 21, 0.18);
  border-radius: 0.28em;
  padding: 0 0.1em;
}

.markdown-editor.is-formatted-mode :deep(.editor-md-fence),
.markdown-editor.is-formatted-mode :deep(.editor-md-hr) {
  color: rgb(var(--v-theme-secondary));
}

.markdown-editor.is-formatted-mode :deep(.editor-md-table-row) {
  display: inline-block;
  width: fit-content;
  min-width: min(100%, 480px);
  padding: 0.05em 0.4em;
  border-radius: 0.28em;
  background: rgba(var(--v-theme-on-background), 0.04);
}

.markdown-editor.is-formatted-mode :deep(.editor-md-table-divider) {
  color: rgb(var(--v-theme-secondary));
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
