/**
 * Route-matches REST-shaped `(url, init)` calls to `librarium-mobile` Tauri
 * commands — the core editing loop (vault list/get, file tree/read/write/
 * create/delete/rename, directory create, render, resolve-link — #56) plus
 * search, tags, backlinks, and metadata (preferences/recent/favorites/
 * bookmarks, plus random/daily — #57), with no embedded server.
 *
 * Deliberately a small, explicit table rather than a generic path-matching
 * framework: each entry is one `method` + one hand-written `RegExp`, so it's
 * obvious at a glance which routes are supported. Anything that doesn't
 * match falls through to `LocalTransportUnsupportedError` — a distinct,
 * typed error (not a 404-shaped `ApiError`) so callers (and #58's capability
 * flags) can tell "this feature isn't available offline" apart from a real
 * HTTP failure.
 *
 * Out of scope here (tracked in #55's inventory comments, unresolved):
 * `apiRawFileUrl`/`apiThumbnailUrl`/`apiDownloadFileUrl` build URLs for
 * direct browser consumption and need a Tauri custom-protocol handler
 * registered on the Rust side — that app-level wiring doesn't exist yet.
 * `apiDeleteTag` (`DELETE .../tags/:tag`, which edits every tagged file) has
 * no `librarium-mobile` command behind it at all — `tag_files` is read-only
 * ("which files have this tag") — so that route is intentionally left
 * unsupported rather than faked. Entity/graph, ML, plugin, and admin routes
 * are server-only on mobile, handled by #58.
 */

import type { TransportResponseLike } from './client';
import {
    mobileBacklinks,
    mobileBookmarksAdd,
    mobileBookmarksList,
    mobileBookmarksRemove,
    mobileDirectoryCreate,
    mobileFavoritesAdd,
    mobileFavoritesList,
    mobileFavoritesRemove,
    mobileFileCreate,
    mobileFileDelete,
    mobileFileRead,
    mobileFileRename,
    mobileFileTree,
    mobileFileWrite,
    mobilePreferencesGet,
    mobilePreferencesReset,
    mobilePreferencesSet,
    mobileRecentList,
    mobileRecentRecord,
    mobileRenderMarkdown,
    mobileRenderMarkdownInVault,
    mobileResolveWikiLink,
    mobileSearchPaged,
    mobileTagFiles,
    mobileTagsList,
    mobileVaultGet,
    mobileVaultList,
} from '@/utils/tauri';
import type { FileNode, UserPreferences } from './types';

/** Thrown for any request the local dispatcher doesn't have a route for. */
export class LocalTransportUnsupportedError extends Error {
    constructor(
        public method: string,
        public path: string,
    ) {
        super(`${method} ${path} is not available offline`);
        this.name = 'LocalTransportUnsupportedError';
    }
}

/**
 * Thrown specifically by the search route when no on-device index exists
 * for this vault yet — distinct from a real, empty `PagedSearchResult`
 * (which means "search ran and found nothing"). Conflating the two would
 * read as "no matches" when the true state is "search hasn't been set up",
 * which is actively misleading (#57's acceptance criterion).
 */
export class LocalSearchUnavailableError extends Error {
    constructor(public vaultId: string) {
        super(`search is not available offline for vault ${vaultId} (no local index)`);
        this.name = 'LocalSearchUnavailableError';
    }
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * `search_paged` rejects with `AppError::NotFound("Vault index not found:
 * ...")`'s `Display` text (`librarium-core`'s `user_message()`) when the
 * vault has never had an index built (#51's `local_search_enabled` off
 * switch, or sync just hasn't run yet). Matching on that specific substring
 * — rather than "not found" generically — avoids misclassifying an
 * unrelated failure (e.g. an IPC error) as "search unavailable".
 */
function isVaultIndexNotFound(e: unknown): boolean {
    return /vault index not found/i.test(errorMessage(e));
}

/** `file_read` rejects with this substring when the target path is absent. */
function isFileNotFound(e: unknown): boolean {
    return /file not found/i.test(errorMessage(e));
}

/** All markdown file paths in a file tree, recursing into directories. */
function flattenMarkdownPaths(nodes: FileNode[]): string[] {
    const out: string[] = [];
    for (const node of nodes) {
        if (node.is_directory) {
            if (node.children) out.push(...flattenMarkdownPaths(node.children));
        } else if (node.path.toLowerCase().endsWith('.md')) {
            out.push(node.path);
        }
    }
    return out;
}

function jsonResponse(body: unknown): TransportResponseLike {
    const text = JSON.stringify(body);
    return {
        ok: true,
        status: 200,
        headers: {
            get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => JSON.parse(text),
        text: async () => text,
    };
}

/** For endpoints that (like `/api/render`) return a raw string body. */
function textResponse(body: string): TransportResponseLike {
    return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        json: async () => { throw new Error('response body is not JSON'); },
        text: async () => body,
    };
}

function noContentResponse(): TransportResponseLike {
    return {
        ok: true,
        status: 204,
        headers: { get: () => null },
        json: async () => { throw new Error('204 response has no body'); },
        text: async () => '',
    };
}

/**
 * Decode a URL path segment exactly once. `apiXxx` functions in `client.ts`
 * are inconsistent about pre-encoding file paths with `encodeURIComponent`
 * (most don't), so a segment may arrive either as a literal path
 * ("notes/My Note.md") or percent-encoded ("notes%2FMy%20Note.md"). Tolerate
 * both: a literal segment has no `%XX` sequences for `decodeURIComponent` to
 * touch, so decoding is a no-op for it; a malformed `%` (not a valid escape)
 * falls back to the raw segment rather than throwing.
 */
function decodeOnce(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function parseJsonBody(init: RequestInit): Record<string, unknown> {
    if (!init.body) return {};
    const raw = typeof init.body === 'string' ? init.body : String(init.body);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
}

// No consumer builds absolute URLs for these routes, and the local transport
// never goes through `fetch`'s WHATWG URL parsing, so `url` is exactly the
// literal string the `apiXxx` function built — safe to strip/parse a query
// string with plain string ops rather than the `URL` constructor.
function stripQuery(url: string): string {
    return url.split('?')[0];
}

function parseQuery(url: string): URLSearchParams {
    const i = url.indexOf('?');
    return new URLSearchParams(i === -1 ? '' : url.slice(i + 1));
}

type RouteHandler = (
    groups: Record<string, string>,
    init: RequestInit,
    url: string,
) => Promise<TransportResponseLike>;

interface RouteEntry {
    method: string;
    pattern: RegExp;
    handler: RouteHandler;
}

const routes: RouteEntry[] = [
    {
        method: 'GET',
        pattern: /^\/api\/vaults$/,
        handler: async () => jsonResponse(await mobileVaultList()),
    },
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)$/,
        handler: async ({ vaultId }) => jsonResponse(await mobileVaultGet(vaultId)),
    },
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/files$/,
        handler: async ({ vaultId }) => jsonResponse(await mobileFileTree(vaultId)),
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/files$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const path = decodeOnce(String(body.path ?? ''));
            const content = body.content == null ? undefined : String(body.content);
            return jsonResponse(await mobileFileCreate(vaultId, path, content));
        },
    },
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/files\/(?<tail>.+)$/,
        handler: async ({ vaultId, tail }) =>
            jsonResponse(await mobileFileRead(vaultId, decodeOnce(tail))),
    },
    {
        method: 'PUT',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/files\/(?<tail>.+)$/,
        handler: async ({ vaultId, tail }, init) => {
            const body = parseJsonBody(init);
            const content = String(body.content ?? '');
            const lastModified = body.last_modified == null ? undefined : String(body.last_modified);
            const frontmatter = body.frontmatter as Record<string, unknown> | undefined;
            return jsonResponse(
                await mobileFileWrite(vaultId, decodeOnce(tail), content, lastModified, frontmatter),
            );
        },
    },
    {
        method: 'DELETE',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/files\/(?<tail>.+)$/,
        handler: async ({ vaultId, tail }) => {
            await mobileFileDelete(vaultId, decodeOnce(tail));
            return noContentResponse();
        },
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/rename$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const from = decodeOnce(String(body.from ?? ''));
            const to = decodeOnce(String(body.to ?? ''));
            const strategy = body.strategy == null ? undefined : String(body.strategy);
            return jsonResponse(await mobileFileRename(vaultId, from, to, strategy));
        },
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/directories$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const path = decodeOnce(String(body.path ?? ''));
            return jsonResponse(await mobileDirectoryCreate(vaultId, path));
        },
    },
    {
        method: 'POST',
        pattern: /^\/api\/render$/,
        handler: async (_groups, init) => {
            const body = parseJsonBody(init);
            const content = String(body.content ?? '');
            return textResponse(await mobileRenderMarkdown(content));
        },
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/render$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const content = String(body.content ?? '');
            const currentFile = body.current_file == null ? undefined : String(body.current_file);
            return textResponse(await mobileRenderMarkdownInVault(vaultId, content, currentFile));
        },
    },
    {
        // client.ts's apiResolveWikiLink actually POSTs (the issue's own
        // route table lists GET, which doesn't match the real client code —
        // matching what apiResolveWikiLink actually sends).
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/resolve-link$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const link = decodeOnce(String(body.link ?? ''));
            const currentFile = body.current_file == null ? undefined : String(body.current_file);
            return jsonResponse(await mobileResolveWikiLink(vaultId, link, currentFile));
        },
    },

    // ── Search (#57) ─────────────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/search$/,
        handler: async ({ vaultId }, _init, url) => {
            const query = parseQuery(url);
            const q = decodeOnce(query.get('q') ?? '');
            const page = Number(query.get('page') ?? '1');
            const pageSize = Number(query.get('page_size') ?? '50');
            try {
                return jsonResponse(await mobileSearchPaged(vaultId, q, page, pageSize));
            } catch (e) {
                if (isVaultIndexNotFound(e)) throw new LocalSearchUnavailableError(vaultId);
                throw e;
            }
        },
    },

    // ── Tags (#57) ───────────────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/tags$/,
        handler: async ({ vaultId }) => jsonResponse(await mobileTagsList(vaultId)),
    },
    {
        // No existing apiXxx caller hits this — client.ts's only tags/:tag
        // route is DELETE (remove a tag from every file), which has no
        // backing mobile command at all (see module doc) and is intentionally
        // left unsupported. Exposed as GET anyway because tag_files is a
        // real, already-implemented mobile capability with no REST
        // equivalent (#50) — "which files have this tag" is useful standalone.
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/tags\/(?<tag>[^/]+)$/,
        handler: async ({ vaultId, tag }) =>
            jsonResponse(await mobileTagFiles(vaultId, decodeOnce(tag))),
    },

    // ── Backlinks (#57) ──────────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/backlinks$/,
        handler: async ({ vaultId }, _init, url) => {
            const path = decodeOnce(parseQuery(url).get('path') ?? '');
            return jsonResponse(await mobileBacklinks(vaultId, path));
        },
    },

    // ── Preferences (#57) ────────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/preferences$/,
        handler: async () => jsonResponse(await mobilePreferencesGet()),
    },
    {
        method: 'PUT',
        pattern: /^\/api\/preferences$/,
        handler: async (_groups, init) => {
            // preferences_set fully overwrites the (singleton) row and
            // returns nothing meaningful — the body itself is the new
            // authoritative state, so echo it back rather than round-tripping.
            const prefs = parseJsonBody(init) as unknown as UserPreferences;
            await mobilePreferencesSet(prefs);
            return jsonResponse(prefs);
        },
    },
    {
        method: 'POST',
        pattern: /^\/api\/preferences\/reset$/,
        handler: async () => jsonResponse(await mobilePreferencesReset()),
    },

    // ── Recent files (#57) ───────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/recent$/,
        handler: async ({ vaultId }) => jsonResponse(await mobileRecentList(vaultId)),
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/recent$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const path = decodeOnce(String(body.path ?? ''));
            await mobileRecentRecord(vaultId, path);
            return noContentResponse();
        },
    },

    // ── Favorites (#57) ──────────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/favorites$/,
        handler: async ({ vaultId }) => jsonResponse(await mobileFavoritesList(vaultId)),
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/favorites$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const path = decodeOnce(String(body.path ?? ''));
            return jsonResponse(await mobileFavoritesAdd(vaultId, path));
        },
    },
    {
        // apiRemoveFavorite sends the path as a query param, not a body.
        method: 'DELETE',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/favorites$/,
        handler: async ({ vaultId }, _init, url) => {
            const path = decodeOnce(parseQuery(url).get('path') ?? '');
            await mobileFavoritesRemove(vaultId, path);
            return noContentResponse();
        },
    },

    // ── Bookmarks (#57) ──────────────────────────────────────────────────────
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/bookmarks$/,
        handler: async ({ vaultId }) => jsonResponse(await mobileBookmarksList(vaultId)),
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/bookmarks$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const path = decodeOnce(String(body.path ?? ''));
            const title = String(body.title ?? '');
            return jsonResponse(await mobileBookmarksAdd(vaultId, path, title));
        },
    },
    {
        method: 'DELETE',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/bookmarks\/(?<bookmarkId>[^/]+)$/,
        handler: async ({ vaultId, bookmarkId }) => {
            await mobileBookmarksRemove(vaultId, decodeOnce(bookmarkId));
            return noContentResponse();
        },
    },

    // ── Random / daily notes (#57) ───────────────────────────────────────────
    // No librarium-mobile command exists for either — both are small and
    // derive entirely from the file tree, so they're implemented here in TS
    // rather than adding Rust commands just to mirror the server's shortcuts.
    {
        method: 'GET',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/random$/,
        handler: async ({ vaultId }) => {
            const paths = flattenMarkdownPaths(await mobileFileTree(vaultId));
            if (paths.length === 0) throw new Error('No markdown files found in vault');
            const path = paths[Math.floor(Math.random() * paths.length)];
            return jsonResponse({ path });
        },
    },
    {
        method: 'POST',
        pattern: /^\/api\/vaults\/(?<vaultId>[^/]+)\/daily$/,
        handler: async ({ vaultId }, init) => {
            const body = parseJsonBody(init);
            const date = String(body.date ?? '');
            const filePath = `${date}.md`;
            try {
                return jsonResponse(await mobileFileRead(vaultId, filePath));
            } catch (e) {
                if (!isFileNotFound(e)) throw e;
                const header = `# ${date}\n\n`;
                return jsonResponse(await mobileFileCreate(vaultId, filePath, header));
            }
        },
    },
];

/** The local transport's actual dispatch, replacing #55's throw-everything stub. */
export async function dispatchLocal(
    url: string,
    init: RequestInit = {},
): Promise<TransportResponseLike> {
    const path = stripQuery(url);
    const method = (init.method ?? 'GET').toUpperCase();

    for (const route of routes) {
        if (route.method !== method) continue;
        const match = path.match(route.pattern);
        if (!match) continue;
        return route.handler(match.groups ?? {}, init, url);
    }

    throw new LocalTransportUnsupportedError(method, path);
}
