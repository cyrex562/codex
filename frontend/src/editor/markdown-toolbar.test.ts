import { describe, it, expect } from 'vitest';
import { applyMarkdownToolbarCommand } from './markdown-toolbar';

describe('applyMarkdownToolbarCommand', () => {
    it('wraps selection with bold markers', () => {
        const res = applyMarkdownToolbarCommand('Hello world', 6, 11, 'bold');
        expect(res.content).toBe('Hello **world**');
    });

    it('inserts placeholder for italic when selection is empty', () => {
        const res = applyMarkdownToolbarCommand('Hello', 5, 5, 'italic');
        expect(res.content).toBe('Hello*italic text*');
    });

    it('applies heading and replaces existing heading markers', () => {
        const res = applyMarkdownToolbarCommand('## Old heading', 0, 0, 'heading_1');
        expect(res.content).toBe('# Old heading');
    });

    it('applies list markers to multiline selection', () => {
        const content = 'alpha\nbeta';
        const res = applyMarkdownToolbarCommand(content, 0, content.length, 'bulleted_list');
        expect(res.content).toBe('- alpha\n- beta');
    });

    it('applies numbered list to multiline selection', () => {
        const content = 'item one\nitem two';
        const res = applyMarkdownToolbarCommand(content, 0, content.length, 'numbered_list');
        expect(res.content).toBe('1. item one\n2. item two');
    });

    it('applies lower alpha ordered list style', () => {
        const content = 'item one\nitem two\nitem three';
        const res = applyMarkdownToolbarCommand(content, 0, content.length, 'numbered_list_lower_alpha');
        expect(res.content).toBe('a. item one\nb. item two\nc. item three');
    });

    it('applies upper roman ordered list style', () => {
        const content = 'first\nsecond\nthird';
        const res = applyMarkdownToolbarCommand(content, 0, content.length, 'numbered_list_upper_roman');
        expect(res.content).toBe('I. first\nII. second\nIII. third');
    });

    it('inserts markdown link wrapper', () => {
        const res = applyMarkdownToolbarCommand('Click', 0, 5, 'link');
        expect(res.content).toBe('[Click](https://)');
    });

    it('inserts code block with selected content', () => {
        const res = applyMarkdownToolbarCommand('const x = 1;', 0, 12, 'code_block');
        expect(res.content).toBe('\n```\nconst x = 1;\n```\n');
    });

    it('inserts markdown table template', () => {
        const res = applyMarkdownToolbarCommand('', 0, 0, 'table');
        expect(res.content).toBe(
            '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |',
        );
    });

    it('inserts table on a new line when cursor is mid-text', () => {
        const res = applyMarkdownToolbarCommand('hello world', 5, 5, 'table');
        expect(res.content).toContain('\n| Column 1 | Column 2 | Column 3 |');
    });
});
