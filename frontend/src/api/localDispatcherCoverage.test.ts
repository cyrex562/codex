/**
 * Static coverage check (issue #59, "both, scoped down" — the frontend half
 * of the contract-test approach; the real drift-detector against the two
 * actual route implementations is the Rust suite at
 * `crates/librarium-mobile/tests/contract_test.rs`).
 *
 * This does NOT compare live response values — that's what the Rust contract
 * test does. It only asserts that every `apiXxx` call in #56/#57's scope
 * still resolves to an entry in `localDispatcher.ts`'s route table, by
 * driving the real `apiXxx` functions through `localTransport` and checking
 * none of them throws `LocalTransportUnsupportedError`. `invoke` is mocked
 * with a generic stub response, since a shape mismatch downstream (a
 * different, non-"unsupported" error) is out of scope here — per-route
 * response-shape coverage already lives in `localDispatcher.test.ts`.
 *
 * Deliberately excludes anything the dispatcher's own module doc marks
 * out-of-scope (raw/thumbnail URLs, reindex, ML, uploads, archives, plugins,
 * auth, admin, vault sharing, entities/graph, and `apiDeleteTag`, which has
 * no backing mobile command at all).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
    apiAddFavorite,
    apiCreateBookmark,
    apiCreateDirectory,
    apiCreateFile,
    apiDeleteBookmark,
    apiDeleteFile,
    apiGetBacklinks,
    apiGetDailyNote,
    apiGetFileTree,
    apiGetPreferences,
    apiGetRandomNote,
    apiGetRecentFiles,
    apiGetVault,
    apiListBookmarks,
    apiListFavorites,
    apiListTags,
    apiListVaults,
    apiReadFile,
    apiRecordRecentFile,
    apiRemoveFavorite,
    apiRenameFile,
    apiRenderMarkdown,
    apiRenderMarkdownInVault,
    apiResetPreferences,
    apiResolveWikiLink,
    apiSearch,
    apiUpdatePreferences,
    apiWriteFile,
    httpTransport,
    localTransport,
    setTransport,
} from './client';
import { LocalTransportUnsupportedError } from './localDispatcher';
import type { UserPreferences } from './types';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

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

async function getInvokeMock() {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke as unknown as ReturnType<typeof vi.fn>;
}

const DUMMY_PREFS: UserPreferences = { theme: 'dark', editor_mode: 'raw', font_size: 14 };

// One entry per #56/#57 apiXxx call — the exact real call sites, not
// hand-copied URLs, so a future drift in client.ts's method/path is what
// this is actually meant to catch.
const IN_SCOPE_CALLS: Array<[string, () => Promise<unknown>]> = [
    ['apiListVaults', () => apiListVaults()],
    ['apiGetVault', () => apiGetVault('v1')],
    ['apiGetFileTree', () => apiGetFileTree('v1')],
    ['apiReadFile', () => apiReadFile('v1', 'a.md')],
    ['apiWriteFile', () => apiWriteFile('v1', 'a.md', { content: 'x' })],
    ['apiCreateFile', () => apiCreateFile('v1', { path: 'a.md', content: 'x' })],
    ['apiDeleteFile', () => apiDeleteFile('v1', 'a.md')],
    ['apiCreateDirectory', () => apiCreateDirectory('v1', 'Inbox')],
    ['apiRenameFile', () => apiRenameFile('v1', 'a.md', 'b.md')],
    ['apiRenderMarkdown', () => apiRenderMarkdown('# hi')],
    ['apiRenderMarkdownInVault', () => apiRenderMarkdownInVault('v1', '# hi')],
    ['apiResolveWikiLink', () => apiResolveWikiLink('v1', 'a')],
    ['apiSearch', () => apiSearch('v1', 'q')],
    ['apiListTags', () => apiListTags('v1')],
    ['apiGetBacklinks', () => apiGetBacklinks('v1', 'a.md')],
    ['apiGetPreferences', () => apiGetPreferences()],
    ['apiUpdatePreferences', () => apiUpdatePreferences(DUMMY_PREFS)],
    ['apiResetPreferences', () => apiResetPreferences()],
    ['apiGetRecentFiles', () => apiGetRecentFiles('v1')],
    ['apiRecordRecentFile', () => apiRecordRecentFile('v1', 'a.md')],
    ['apiListFavorites', () => apiListFavorites('v1')],
    ['apiAddFavorite', () => apiAddFavorite('v1', 'a.md')],
    ['apiRemoveFavorite', () => apiRemoveFavorite('v1', 'a.md')],
    ['apiListBookmarks', () => apiListBookmarks('v1')],
    ['apiCreateBookmark', () => apiCreateBookmark('v1', 'a.md', 'A')],
    ['apiDeleteBookmark', () => apiDeleteBookmark('v1', 'bm1')],
    ['apiGetRandomNote', () => apiGetRandomNote('v1')],
    ['apiGetDailyNote', () => apiGetDailyNote('v1', '2020-01-01')],
];

describe('localDispatcher route table covers every #56/#57 apiXxx call (#59)', () => {
    beforeEach(async () => {
        localStorage.clear();
        setActivePinia(createPinia());
        setTauriContext(true);
        vi.clearAllMocks();
        const invoke = await getInvokeMock();
        // A generic stub: handler-internal shape mismatches (e.g. a
        // destructure on a field this stub doesn't have) are NOT what this
        // test checks for — only whether the route matched the table at
        // all, i.e. whether dispatchLocal got as far as calling invoke.
        invoke.mockResolvedValue({});
        setTransport(localTransport);
    });

    // Never let this file's transport override leak into another test file.
    afterEach(() => setTransport(httpTransport));

    it.each(IN_SCOPE_CALLS)('%s dispatches to a supported local route', async (_name, call) => {
        try {
            await call();
        } catch (e) {
            expect(e).not.toBeInstanceOf(LocalTransportUnsupportedError);
        }
    });
});
