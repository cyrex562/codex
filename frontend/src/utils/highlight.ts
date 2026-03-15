function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface MarkdownFoldRegion {
  type: 'heading' | 'code';
  startLine: number;
  endLine: number;
}

export interface FormattedMarkdownRenderResult {
  html: string;
  foldRegions: MarkdownFoldRegion[];
}

function formatInlineMarkdown(text: string): string {
  let html = escapeHtml(text);

  html = html.replace(/(`+)([^`\n]+?)\1/g, (_match, ticks: string, code: string) => {
    return `<span class="editor-md-inline-code"><span class="editor-md-syntax">${ticks}</span>${code}<span class="editor-md-syntax">${ticks}</span></span>`;
  });

  html = html.replace(/(\[\[[^\]]+\]\])/g, '<span class="editor-md-wikilink">$1</span>');
  html = html.replace(/(\[[^\]]+\]\([^\)]+\))/g, '<span class="editor-md-link">$1</span>');
  html = html.replace(/(^|[\s(])(#[A-Za-z0-9_\/-]+)/g, '$1<span class="editor-md-tag">$2</span>');

  html = html.replace(/(\*\*)(.+?)(\*\*)/g, '<span class="editor-md-strong"><span class="editor-md-syntax">$1</span>$2<span class="editor-md-syntax">$3</span></span>');
  html = html.replace(/(__)(.+?)(__)/g, '<span class="editor-md-strong"><span class="editor-md-syntax">$1</span>$2<span class="editor-md-syntax">$3</span></span>');
  html = html.replace(/(~~)(.+?)(~~)/g, '<span class="editor-md-strikethrough"><span class="editor-md-syntax">$1</span>$2<span class="editor-md-syntax">$3</span></span>');
  html = html.replace(/(==)(.+?)(==)/g, '<span class="editor-md-highlight"><span class="editor-md-syntax">$1</span>$2<span class="editor-md-syntax">$3</span></span>');
  html = html.replace(/(^|[^*])\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, '$1<span class="editor-md-emphasis"><span class="editor-md-syntax">*</span>$2<span class="editor-md-syntax">*</span></span>');
  html = html.replace(/(^|[^_])_(?!\s)([^_]+?)(?<!\s)_(?!_)/g, '$1<span class="editor-md-emphasis"><span class="editor-md-syntax">_</span>$2<span class="editor-md-syntax">_</span></span>');

  return html;
}

function formatMarkdownLine(line: string): string {
  const headingMatch = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
  if (headingMatch) {
    const [, indent, hashes, space, rest] = headingMatch;
    return `${escapeHtml(indent)}<span class="editor-md-heading editor-md-heading-${hashes.length}"><span class="editor-md-syntax">${escapeHtml(hashes)}</span>${escapeHtml(space)}${formatInlineMarkdown(rest)}</span>`;
  }

  const blockquoteMatch = line.match(/^(\s*)(>+)(\s?)(.*)$/);
  if (blockquoteMatch) {
    const [, indent, markers, space, rest] = blockquoteMatch;
    return `${escapeHtml(indent)}<span class="editor-md-blockquote"><span class="editor-md-syntax">${escapeHtml(markers)}</span>${escapeHtml(space)}<span class="editor-md-blockquote-content">${formatInlineMarkdown(rest)}</span></span>`;
  }

  const taskMatch = line.match(/^(\s*)((?:[-*+]|\d+[.)]))(\s+)(\[(?: |x|X)\])(\s*)(.*)$/);
  if (taskMatch) {
    const [, indent, marker, gap, checkbox, afterCheckbox, rest] = taskMatch;
    const checked = /\[[xX]\]/.test(checkbox);
    return `${escapeHtml(indent)}<span class="editor-md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(gap)}<span class="editor-md-checkbox ${checked ? 'is-checked' : ''}">${escapeHtml(checkbox)}</span>${escapeHtml(afterCheckbox)}<span class="editor-md-task-text">${formatInlineMarkdown(rest)}</span>`;
  }

  const listMatch = line.match(/^(\s*)((?:[-*+]|\d+[.)]))(\s+)(.*)$/);
  if (listMatch) {
    const [, indent, marker, gap, rest] = listMatch;
    return `${escapeHtml(indent)}<span class="editor-md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(gap)}${formatInlineMarkdown(rest)}`;
  }

  const fencedCodeMatch = line.match(/^(\s*)(```|~~~)(.*)$/);
  if (fencedCodeMatch) {
    const [, indent, fence, rest] = fencedCodeMatch;
    return `${escapeHtml(indent)}<span class="editor-md-fence"><span class="editor-md-syntax">${escapeHtml(fence)}</span>${formatInlineMarkdown(rest)}</span>`;
  }

  const tableDividerMatch = line.match(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/);
  if (tableDividerMatch) {
    return `<span class="editor-md-table-row editor-md-table-divider">${escapeHtml(line)}</span>`;
  }

  const tableRowMatch = line.match(/^\s*\|?.*\|.*\|\s*$/);
  if (tableRowMatch) {
    return `<span class="editor-md-table-row">${formatInlineMarkdown(line)}</span>`;
  }

  const hrMatch = line.match(/^(\s*)([-*_])(?:\s*\2){2,}\s*$/);
  if (hrMatch) {
    return `<span class="editor-md-hr">${escapeHtml(line)}</span>`;
  }

  return formatInlineMarkdown(line);
}

function collectCodeFoldRegions(lines: string[]): MarkdownFoldRegion[] {
  const regions: MarkdownFoldRegion[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const startMatch = lines[i].match(/^(\s*)(```|~~~)(.*)$/);
    if (!startMatch) continue;

    const fence = startMatch[2];
    let endLine = lines.length - 1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (new RegExp(`^\\s*${fence}\\s*$`).test(lines[j])) {
        endLine = j;
        break;
      }
    }

    if (endLine > i) {
      regions.push({ type: 'code', startLine: i, endLine });
    }

    i = Math.max(i, endLine);
  }

  return regions;
}

function collectHeadingFoldRegions(lines: string[], codeRegions: MarkdownFoldRegion[]): MarkdownFoldRegion[] {
  const regions: MarkdownFoldRegion[] = [];
  const codeLineSet = new Set<number>();
  for (const region of codeRegions) {
    for (let line = region.startLine; line <= region.endLine; line += 1) {
      codeLineSet.add(line);
    }
  }

  const headings: Array<{ line: number; level: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (codeLineSet.has(i)) continue;
    const match = lines[i].match(/^\s*(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({ line: i, level: match[1].length });
    }
  }

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    let endLine = lines.length - 1;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= current.level) {
        endLine = headings[j].line - 1;
        break;
      }
    }

    if (endLine > current.line) {
      regions.push({ type: 'heading', startLine: current.line, endLine });
    }
  }

  return regions;
}

export function renderFormattedMarkdown(text: string, collapsedStarts: Set<number> = new Set()): FormattedMarkdownRenderResult {
  const lines = text.split('\n');
  const codeRegions = collectCodeFoldRegions(lines);
  const headingRegions = collectHeadingFoldRegions(lines, codeRegions);
  const foldRegions = [...headingRegions, ...codeRegions].sort((a, b) => a.startLine - b.startLine);
  const foldByStart = new Map<number, MarkdownFoldRegion>(foldRegions.map((region) => [region.startLine, region]));
  const headingRegionByStart = new Map<number, MarkdownFoldRegion>(headingRegions.map((region) => [region.startLine, region]));
  const hiddenLines = new Set<number>();
  const headingDepthByLine = new Array(lines.length).fill(0);

  const activeHeadingEnds: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    while (activeHeadingEnds.length > 0 && i > activeHeadingEnds[activeHeadingEnds.length - 1]) {
      activeHeadingEnds.pop();
    }
    headingDepthByLine[i] = activeHeadingEnds.length;

    const headingRegion = headingRegionByStart.get(i);
    if (headingRegion) {
      activeHeadingEnds.push(headingRegion.endLine);
    }
  }

  for (const startLine of collapsedStarts) {
    const region = foldByStart.get(startLine);
    if (!region) continue;
    for (let line = region.startLine + 1; line <= region.endLine; line += 1) {
      hiddenLines.add(line);
    }
  }

  const html = lines.map((line, index) => {
    const region = foldByStart.get(index);
    const isCollapsed = region ? collapsedStarts.has(index) : false;
    const hiddenClass = hiddenLines.has(index) ? ' is-hidden' : '';
    const depth = headingDepthByLine[index] ?? 0;
    const nestedClass = depth > 0 ? ' is-nested' : '';
    const hiddenLineCount = region ? (region.endLine - region.startLine) : 0;
    const toggle = region
      ? `<span contenteditable="false" class="editor-md-fold-toggle${isCollapsed ? ' is-collapsed' : ''}" data-fold-start="${index}" title="${isCollapsed ? 'Expand' : 'Collapse'} ${region.type === 'heading' ? 'section' : 'code block'}"></span>`
      : '<span contenteditable="false" class="editor-md-fold-spacer"></span>';
    const summary = region && isCollapsed
      ? `<span contenteditable="false" class="editor-md-fold-summary" data-hidden-lines="${hiddenLineCount}"></span>`
      : '';

    return `<span class="editor-md-line${hiddenClass}${nestedClass}" style="--fold-depth:${depth}" data-line="${index}">${toggle}${formatMarkdownLine(line)}${summary}</span>`;
  }).join('\n');

  return { html, foldRegions };
}

/** Called by CodeJar to keep the editor in plain text mode without syntax styling. */
export function highlightPlainText(editor: HTMLElement) {
  const text = editor.textContent ?? '';
  if (editor.childNodes.length !== 1 || editor.firstChild?.nodeType !== Node.TEXT_NODE || editor.textContent !== text) {
    editor.textContent = text;
  }
}
