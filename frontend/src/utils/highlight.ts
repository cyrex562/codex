/**
 * Lightweight syntax highlighter for the CodeJar markdown editor.
 * Uses highlight.js for fenced code blocks and applies simple token
 * coloring for inline Markdown syntax (headings, bold, italic, links).
 */
import hljs from 'highlight.js/lib/core';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('markdown', markdown);

/** Called by CodeJar to highlight the editor element in-place. */
export function highlight(editor: HTMLElement) {
  const result = hljs.highlight(editor.textContent ?? '', { language: 'markdown' });
  // Only update if content differs to avoid cursor clobbering
  if (editor.innerHTML !== result.value) {
    editor.innerHTML = result.value;
  }
}
