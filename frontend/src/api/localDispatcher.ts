/**
 * Route-matches REST-shaped `(url, init)` calls to `librarium-mobile` Tauri
 * commands — the core editing loop (vault list/get, file tree/read/write/
 * create/delete/rename, directory create, render, resolve-link) with no
 * embedded server (Route C, issue #56).
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
 * Search/tags/metadata routes are #57's job.
 */

import type { TransportResponseLike } from './client';
import {
    mobileDirectoryCreate,
    mobileFileCreate,
    mobileFileDelete,
    mobileFileRead,
    mobileFileRename,
    mobileFileTree,
    mobileFileWrite,
    mobileRenderMarkdown,
    mobileRenderMarkdownInVault,
    mobileResolveWikiLink,
    mobileVaultGet,
    mobileVaultList,
} from '@/utils/tauri';

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
// literal string the `apiXxx` function built — safe to strip a query string
// with a plain split.
function stripQuery(url: string): string {
    return url.split('?')[0];
}

type RouteHandler = (
    groups: Record<string, string>,
    init: RequestInit,
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
        return route.handler(match.groups ?? {}, init);
    }

    throw new LocalTransportUnsupportedError(method, path);
}
