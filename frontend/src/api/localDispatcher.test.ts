import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchLocal, LocalSearchUnavailableError, LocalTransportUnsupportedError } from './localDispatcher';
import type { PagedSearchResult } from './types';

// Mock the Tauri core `invoke` the same way utils/tauri.test.ts does (it's a
// dynamic import inside utils/tauri.ts, which localDispatcher.ts calls into).
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

async function getInvokeMock() {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke as unknown as ReturnType<typeof vi.fn>;
}

function setTauriContext(active: boolean) {
    if (active) {
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
            value: {},
            writable: true,
            configurable: true,
        });
    } else {
        try {
            delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
        } catch { /* noop */ }
    }
}

function jsonInit(method: string, body?: unknown): RequestInit {
    return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}

beforeEach(async () => {
    setTauriContext(true);
    vi.clearAllMocks();
});

describe('localDispatcher route table (#56)', () => {
    it('GET /api/vaults -> vault_list', async () => {
        const invoke = await getInvokeMock();
        const vaults = [{ id: 'v1', name: 'Vault' }];
        invoke.mockResolvedValueOnce(vaults);

        const res = await dispatchLocal('/api/vaults', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('vault_list');
        expect(res.ok).toBe(true);
        await expect(res.json()).resolves.toEqual(vaults);
    });

    it('GET /api/vaults/:id -> vault_get', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ id: 'v1', name: 'Vault' });

        const res = await dispatchLocal('/api/vaults/v1', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('vault_get', { vaultId: 'v1' });
        await expect(res.json()).resolves.toEqual({ id: 'v1', name: 'Vault' });
    });

    it('GET /api/vaults/:id/files -> file_tree', async () => {
        const invoke = await getInvokeMock();
        const tree = [{ name: 'a.md', path: 'a.md', is_directory: false }];
        invoke.mockResolvedValueOnce(tree);

        const res = await dispatchLocal('/api/vaults/v1/files', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_tree', { vaultId: 'v1' });
        await expect(res.json()).resolves.toEqual(tree);
    });

    it('GET /api/vaults/:id/files/:tail -> file_read', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'notes/a.md', content: 'hi', modified: '2020-01-01' });

        const res = await dispatchLocal('/api/vaults/v1/files/notes/a.md', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: 'notes/a.md' });
        await expect(res.json()).resolves.toEqual({ path: 'notes/a.md', content: 'hi', modified: '2020-01-01' });
    });

    it('PUT /api/vaults/:id/files/:tail -> file_write', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'a.md', content: 'new', modified: '2020-01-02' });

        const res = await dispatchLocal('/api/vaults/v1/files/a.md', {
            ...jsonInit('PUT', { content: 'new', last_modified: '2020-01-01', frontmatter: { tags: ['x'] } }),
        });

        expect(invoke).toHaveBeenCalledWith('file_write', {
            vaultId: 'v1',
            filePath: 'a.md',
            content: 'new',
            lastModified: '2020-01-01',
            frontmatter: { tags: ['x'] },
        });
        await expect(res.json()).resolves.toEqual({ path: 'a.md', content: 'new', modified: '2020-01-02' });
    });

    it('POST /api/vaults/:id/files -> file_create', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'new.md', content: 'body', modified: '2020-01-01' });

        const res = await dispatchLocal('/api/vaults/v1/files', jsonInit('POST', { path: 'new.md', content: 'body' }));

        expect(invoke).toHaveBeenCalledWith('file_create', { vaultId: 'v1', filePath: 'new.md', content: 'body' });
        await expect(res.json()).resolves.toEqual({ path: 'new.md', content: 'body', modified: '2020-01-01' });
    });

    it('DELETE /api/vaults/:id/files/:tail -> file_delete, 204 no content', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce(null);

        const res = await dispatchLocal('/api/vaults/v1/files/a.md', { method: 'DELETE' });

        expect(invoke).toHaveBeenCalledWith('file_delete', { vaultId: 'v1', filePath: 'a.md' });
        expect(res.status).toBe(204);
        expect(res.ok).toBe(true);
    });

    it('POST /api/vaults/:id/rename -> file_rename', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ from: 'a.md', to: 'b.md', new_path: 'b.md' });

        const res = await dispatchLocal(
            '/api/vaults/v1/rename',
            jsonInit('POST', { from: 'a.md', to: 'b.md', strategy: 'autorename' }),
        );

        expect(invoke).toHaveBeenCalledWith('file_rename', {
            vaultId: 'v1',
            from: 'a.md',
            to: 'b.md',
            strategy: 'autorename',
        });
        await expect(res.json()).resolves.toEqual({ from: 'a.md', to: 'b.md', new_path: 'b.md' });
    });

    it('POST /api/vaults/:id/directories -> directory_create', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'Inbox' });

        const res = await dispatchLocal('/api/vaults/v1/directories', jsonInit('POST', { path: 'Inbox' }));

        expect(invoke).toHaveBeenCalledWith('directory_create', { vaultId: 'v1', dirPath: 'Inbox' });
        await expect(res.json()).resolves.toEqual({ path: 'Inbox' });
    });

    it('POST /api/render -> render_markdown, raw text response', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce('<p>hi</p>');

        const res = await dispatchLocal('/api/render', jsonInit('POST', { content: '*hi*' }));

        expect(invoke).toHaveBeenCalledWith('render_markdown', { content: '*hi*' });
        await expect(res.text()).resolves.toBe('<p>hi</p>');
        expect(res.headers.get('content-type')).toBe('text/html');
    });

    it('POST /api/vaults/:id/render -> render_markdown_in_vault', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce('<p>linked</p>');

        const res = await dispatchLocal(
            '/api/vaults/v1/render',
            jsonInit('POST', { content: '[[a]]', current_file: 'b.md' }),
        );

        expect(invoke).toHaveBeenCalledWith('render_markdown_in_vault', {
            vaultId: 'v1',
            content: '[[a]]',
            currentFile: 'b.md',
        });
        await expect(res.text()).resolves.toBe('<p>linked</p>');
    });

    it('POST /api/vaults/:id/resolve-link -> resolve_wiki_link', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'a.md', exists: true, alternatives: [], ambiguous: false });

        const res = await dispatchLocal(
            '/api/vaults/v1/resolve-link',
            jsonInit('POST', { link: 'a', current_file: 'b.md' }),
        );

        expect(invoke).toHaveBeenCalledWith('resolve_wiki_link', {
            vaultId: 'v1',
            link: 'a',
            currentFile: 'b.md',
        });
        await expect(res.json()).resolves.toEqual({ path: 'a.md', exists: true, alternatives: [], ambiguous: false });
    });
});

describe('localDispatcher round trip and path encoding (#56)', () => {
    it('file_write then file_read returns the written content through the dispatcher', async () => {
        const invoke = await getInvokeMock();
        let stored = '';
        invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
            if (cmd === 'file_write') {
                stored = String(args?.content);
                return { path: args?.filePath, content: stored, modified: '2020-01-01' };
            }
            if (cmd === 'file_read') {
                return { path: args?.filePath, content: stored, modified: '2020-01-01' };
            }
            throw new Error(`unexpected command ${cmd}`);
        });

        await dispatchLocal('/api/vaults/v1/files/a.md', jsonInit('PUT', { content: 'round trip content' }));
        const res = await dispatchLocal('/api/vaults/v1/files/a.md', { method: 'GET' });

        await expect(res.json()).resolves.toMatchObject({ content: 'round trip content' });
    });

    it('decodes a literal (unencoded) path with a space', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'My Notes/a.md', content: '', modified: '' });

        await dispatchLocal('/api/vaults/v1/files/My Notes/a.md', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: 'My Notes/a.md' });
    });

    it('decodes an encoded path with a space (%20)', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'My Notes/a.md', content: '', modified: '' });

        await dispatchLocal('/api/vaults/v1/files/My%20Notes/a.md', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: 'My Notes/a.md' });
    });

    it('decodes an encoded "#" (%23) without treating it as a fragment', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: 'note #1.md', content: '', modified: '' });

        await dispatchLocal('/api/vaults/v1/files/note%20%231.md', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: 'note #1.md' });
    });

    it('decodes non-ASCII (unicode) characters in a path', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: '笔记/café.md', content: '', modified: '' });

        await dispatchLocal(`/api/vaults/v1/files/${encodeURIComponent('笔记/café.md')}`, { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: '笔记/café.md' });
    });

    it('does not double-decode a path that was never percent-encoded', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: '100% done.md', content: '', modified: '' });

        // A literal, un-encoded "%" that isn't part of a valid escape sequence
        // must survive decodeURIComponent's tolerant fallback unchanged.
        await dispatchLocal('/api/vaults/v1/files/100% done.md', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: '100% done.md' });
    });
});

describe('localDispatcher unsupported routes (#56)', () => {
    it('throws LocalTransportUnsupportedError for a route not in the table', async () => {
        // Entity/graph routes are server-only on mobile (#57's own out-of-scope
        // list) — search itself is now a real route as of #57.
        await expect(dispatchLocal('/api/vaults/v1/entity-graph', { method: 'GET' }))
            .rejects.toBeInstanceOf(LocalTransportUnsupportedError);
    });

    it('throws LocalTransportUnsupportedError for a known path with an unsupported method', async () => {
        await expect(dispatchLocal('/api/vaults/v1', { method: 'DELETE' }))
            .rejects.toBeInstanceOf(LocalTransportUnsupportedError);
    });

    it('the error message names the method and path, not a generic 404', async () => {
        const err = await dispatchLocal('/api/plugins', { method: 'GET' }).catch((e) => e);
        expect(err).toBeInstanceOf(LocalTransportUnsupportedError);
        expect((err as LocalTransportUnsupportedError).message).toBe('GET /api/plugins is not available offline');
    });

    it('DELETE .../tags/:tag is unsupported (no backing mobile command)', async () => {
        await expect(dispatchLocal('/api/vaults/v1/tags/urgent', { method: 'DELETE' }))
            .rejects.toBeInstanceOf(LocalTransportUnsupportedError);
    });
});

describe('localDispatcher search route (#57)', () => {
    it('GET .../search -> search_paged, PagedSearchResult shape preserved', async () => {
        const invoke = await getInvokeMock();
        const result: PagedSearchResult = {
            results: [{ path: 'a.md', title: 'A', matches: [], score: 1, labels: [] }],
            total_count: 1,
            page: 1,
            page_size: 50,
        };
        invoke.mockResolvedValueOnce(result);

        const res = await dispatchLocal('/api/vaults/v1/search?q=hello&page=1&page_size=50', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('search_paged', {
            vaultId: 'v1',
            query: 'hello',
            page: 1,
            pageSize: 50,
        });
        await expect(res.json()).resolves.toEqual(result);
    });

    it('decodes an encoded query string', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ results: [], total_count: 0, page: 1, page_size: 50 });

        await dispatchLocal('/api/vaults/v1/search?q=a%20b&page=2&page_size=10', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('search_paged', {
            vaultId: 'v1',
            query: 'a b',
            page: 2,
            pageSize: 10,
        });
    });

    it('throws LocalSearchUnavailableError (not an empty result) when no index exists', async () => {
        const invoke = await getInvokeMock();
        invoke.mockRejectedValueOnce(
            new Error('The requested resource was not found: Vault index not found: v1'),
        );

        const err = await dispatchLocal('/api/vaults/v1/search?q=x', { method: 'GET' }).catch((e) => e);

        expect(err).toBeInstanceOf(LocalSearchUnavailableError);
        expect(err).not.toBeInstanceOf(LocalTransportUnsupportedError);
    });

    it('propagates an unrelated search failure unchanged (not misclassified as unavailable)', async () => {
        const invoke = await getInvokeMock();
        invoke.mockRejectedValueOnce(new Error('ipc channel closed'));

        const err = await dispatchLocal('/api/vaults/v1/search?q=x', { method: 'GET' }).catch((e) => e);

        expect(err).not.toBeInstanceOf(LocalSearchUnavailableError);
        expect((err as Error).message).toBe('ipc channel closed');
    });
});

describe('localDispatcher tags and backlinks (#57)', () => {
    it('GET .../tags -> tags_list', async () => {
        const invoke = await getInvokeMock();
        const tags = [{ tag: 'urgent', count: 2, files: ['a.md', 'b.md'] }];
        invoke.mockResolvedValueOnce(tags);

        const res = await dispatchLocal('/api/vaults/v1/tags', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('tags_list', { vaultId: 'v1' });
        await expect(res.json()).resolves.toEqual(tags);
    });

    it('GET .../tags/:tag -> tag_files', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce(['a.md', 'b.md']);

        const res = await dispatchLocal('/api/vaults/v1/tags/urgent', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('tag_files', { vaultId: 'v1', tag: 'urgent' });
        await expect(res.json()).resolves.toEqual(['a.md', 'b.md']);
    });

    it('GET .../backlinks -> backlinks, path from query string', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce([{ path: 'a.md', title: 'A' }]);

        const res = await dispatchLocal('/api/vaults/v1/backlinks?path=notes%2Fb.md', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('backlinks', { vaultId: 'v1', path: 'notes/b.md' });
        await expect(res.json()).resolves.toEqual([{ path: 'a.md', title: 'A' }]);
    });
});

describe('localDispatcher preferences (#57)', () => {
    it('round-trips: PUT persists, GET returns the same preferences', async () => {
        const invoke = await getInvokeMock();
        const prefs = { theme: 'dark', editor_mode: 'raw', font_size: 14 };
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'preferences_set') return null;
            if (cmd === 'preferences_get') return prefs;
            throw new Error(`unexpected command ${cmd}`);
        });

        const putRes = await dispatchLocal('/api/preferences', {
            method: 'PUT',
            body: JSON.stringify(prefs),
        });
        expect(invoke).toHaveBeenCalledWith('preferences_set', { preferences: prefs });
        await expect(putRes.json()).resolves.toEqual(prefs);

        const getRes = await dispatchLocal('/api/preferences', { method: 'GET' });
        expect(invoke).toHaveBeenCalledWith('preferences_get');
        await expect(getRes.json()).resolves.toEqual(prefs);
    });

    it('POST .../preferences/reset -> preferences_reset', async () => {
        const invoke = await getInvokeMock();
        const defaults = { theme: 'light', editor_mode: 'wysiwyg', font_size: 16 };
        invoke.mockResolvedValueOnce(defaults);

        const res = await dispatchLocal('/api/preferences/reset', { method: 'POST' });

        expect(invoke).toHaveBeenCalledWith('preferences_reset');
        await expect(res.json()).resolves.toEqual(defaults);
    });
});

describe('localDispatcher recent/favorites/bookmarks (#57)', () => {
    it('GET/POST .../recent -> recent_list / recent_record', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce(['a.md']);
        const listRes = await dispatchLocal('/api/vaults/v1/recent', { method: 'GET' });
        expect(invoke).toHaveBeenCalledWith('recent_list', { vaultId: 'v1' });
        await expect(listRes.json()).resolves.toEqual(['a.md']);

        invoke.mockResolvedValueOnce(null);
        await dispatchLocal('/api/vaults/v1/recent', { method: 'POST', body: JSON.stringify({ path: 'b.md' }) });
        expect(invoke).toHaveBeenCalledWith('recent_record', { vaultId: 'v1', path: 'b.md' });
    });

    it('GET/POST/DELETE .../favorites -> favorites_list / favorites_add / favorites_remove', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce([{ vault_id: 'v1', path: 'a.md', created_at: 't' }]);
        await dispatchLocal('/api/vaults/v1/favorites', { method: 'GET' });
        expect(invoke).toHaveBeenCalledWith('favorites_list', { vaultId: 'v1' });

        invoke.mockResolvedValueOnce({ vault_id: 'v1', path: 'a.md', created_at: 't' });
        await dispatchLocal('/api/vaults/v1/favorites', { method: 'POST', body: JSON.stringify({ path: 'a.md' }) });
        expect(invoke).toHaveBeenCalledWith('favorites_add', { vaultId: 'v1', path: 'a.md' });

        invoke.mockResolvedValueOnce(null);
        await dispatchLocal('/api/vaults/v1/favorites?path=a.md', { method: 'DELETE' });
        expect(invoke).toHaveBeenCalledWith('favorites_remove', { vaultId: 'v1', path: 'a.md' });
    });

    it('GET/POST/DELETE .../bookmarks -> bookmarks_list / bookmarks_add / bookmarks_remove', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce([]);
        await dispatchLocal('/api/vaults/v1/bookmarks', { method: 'GET' });
        expect(invoke).toHaveBeenCalledWith('bookmarks_list', { vaultId: 'v1' });

        invoke.mockResolvedValueOnce({ id: 'bm1', vault_id: 'v1', path: 'a.md', title: 'A', created_at: 't' });
        await dispatchLocal('/api/vaults/v1/bookmarks', {
            method: 'POST',
            body: JSON.stringify({ path: 'a.md', title: 'A' }),
        });
        expect(invoke).toHaveBeenCalledWith('bookmarks_add', { vaultId: 'v1', path: 'a.md', title: 'A' });

        invoke.mockResolvedValueOnce(null);
        await dispatchLocal('/api/vaults/v1/bookmarks/bm1', { method: 'DELETE' });
        expect(invoke).toHaveBeenCalledWith('bookmarks_remove', { vaultId: 'v1', bookmarkId: 'bm1' });
    });
});

describe('localDispatcher random/daily notes (#57)', () => {
    it('GET .../random picks a markdown file derived from the file tree', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce([
            { name: 'a.md', path: 'a.md', is_directory: false },
            { name: 'notes', path: 'notes', is_directory: true, children: [
                { name: 'b.md', path: 'notes/b.md', is_directory: false },
                { name: 'img.png', path: 'notes/img.png', is_directory: false },
            ] },
        ]);

        const res = await dispatchLocal('/api/vaults/v1/random', { method: 'GET' });

        expect(invoke).toHaveBeenCalledWith('file_tree', { vaultId: 'v1' });
        const body = (await res.json()) as { path: string };
        expect(['a.md', 'notes/b.md']).toContain(body.path);
    });

    it('GET .../random throws when the vault has no markdown files', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce([{ name: 'img.png', path: 'img.png', is_directory: false }]);

        await expect(dispatchLocal('/api/vaults/v1/random', { method: 'GET' }))
            .rejects.toThrow(/no markdown files/i);
    });

    it('POST .../daily reads an existing daily note without creating it', async () => {
        const invoke = await getInvokeMock();
        invoke.mockResolvedValueOnce({ path: '2020-01-01.md', content: 'existing', modified: 't' });

        const res = await dispatchLocal('/api/vaults/v1/daily', {
            method: 'POST',
            body: JSON.stringify({ date: '2020-01-01' }),
        });

        expect(invoke).toHaveBeenCalledWith('file_read', { vaultId: 'v1', filePath: '2020-01-01.md' });
        await expect(res.json()).resolves.toMatchObject({ content: 'existing' });
    });

    it('POST .../daily creates the note with a default header when it does not exist yet', async () => {
        const invoke = await getInvokeMock();
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'file_read') {
                throw new Error('The requested resource was not found: File not found: 2020-01-02.md');
            }
            if (cmd === 'file_create') {
                return { path: '2020-01-02.md', content: '# 2020-01-02\n\n', modified: 't' };
            }
            throw new Error(`unexpected command ${cmd}`);
        });

        const res = await dispatchLocal('/api/vaults/v1/daily', {
            method: 'POST',
            body: JSON.stringify({ date: '2020-01-02' }),
        });

        expect(invoke).toHaveBeenCalledWith('file_create', {
            vaultId: 'v1',
            filePath: '2020-01-02.md',
            content: '# 2020-01-02\n\n',
        });
        await expect(res.json()).resolves.toMatchObject({ content: '# 2020-01-02\n\n' });
    });
});
