import type {
    Vault,
    CreateVaultRequest,
    FileNode,
    FileContent,
    UpdateFileRequest,
    CreateFileRequest,
    PagedSearchResult,
    SearchResult,
    UserPreferences,
    UploadSessionResponse,
    LoginResponse,
    TotpLoginVerifyResponse,
    AuthenticatedUserProfile,
    GroupInfo,
    GroupMember,
    CreateGroupRequest,
    AddGroupMemberRequest,
    VaultShareList,
    ShareVaultWithUserRequest,
    ShareVaultWithGroupRequest,
    AdminUser,
    CreateUserRequest,
    CreateUserResponse,
    ChangePasswordRequest,
    ImportResultItem,
    Bookmark,
    Favorite,
    TagEntry,
    BacklinkEntry,
    GenerateOutlineRequest,
    NoteOutlineResponse,
    AnalyzeNoteRequest,
    NoteAnalysis,
    GenerateOrganizationSuggestionsRequest,
    OrganizationSuggestionsResponse,
    RenameSuggestionRequest,
    RenameSuggestionResponse,
    ApplyOrganizationSuggestionResponse,
    OrganizationSuggestion,
    UndoMlActionResponse,
    OrganizeVaultRequest,
    OrganizationPlan,
    ApplyPlanRequest,
    ApplyPlanResponse,
    Entity,
    EntityRelation,
    EntityTypeSchema,
    RelationTypeSchema,
    GraphData,
    ApiKeyInfo,
    CreateApiKeyRequest,
    CreateApiKeyResponse,
} from './types';
import { useAuthStore } from '@/stores/auth';

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public body?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

// ── Pluggable transport ──────────────────────────────────────────────────────
//
// `request()` below talks to `activeTransport` rather than `fetch` directly,
// so the whole app can run against a local (Tauri command) backend without
// touching any of this file's ~60 `apiXxx` consumers. Only two things a
// transport needs to produce: the subset of `Response` that `request()`
// actually reads (`ok`/`status`/`headers.get`/`json`/`text` — a real
// `fetch` `Response` already satisfies this structurally).
export interface TransportResponseLike {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: { get(name: string): string | null };
    json(): Promise<unknown>;
    text(): Promise<string>;
}

export type Transport = (url: string, init?: RequestInit) => Promise<TransportResponseLike>;

/** Today's behavior, unchanged: a thin passthrough to `fetch`. */
export const httpTransport: Transport = (url, init) => fetch(url, init);

/**
 * Dispatches to `librarium-mobile`'s Tauri commands instead of HTTP.
 *
 * Not implemented yet — the dispatcher itself (mapping each REST-shaped
 * `(url, init)` call to the matching `invoke(...)`) is #56 and #57's job.
 * This exists now so the selection plumbing below has a real, correctly
 * typed second implementation to select between, and so tests can exercise
 * both branches structurally ahead of that dispatcher landing.
 */
export const localTransport: Transport = async () => {
    throw new Error(
        'localTransport is not implemented yet — see Route C issues #56 and #57',
    );
};

function resolveDefaultTransport(): Transport {
    // No mobile shell exists yet (Route C phase 3, issues #61-#63): today's
    // only Tauri build is the desktop shell, which embeds a real server and
    // talks HTTP just like the browser build — so `isTauri()` alone can't be
    // the signal here. Until the mobile shell's own bootstrap can mark
    // itself distinctly (e.g. by calling `setTransport(localTransport)`
    // directly), an explicit env override is the only trigger, keeping
    // today's behavior unchanged for every build that actually exists.
    if (
        typeof window !== 'undefined' &&
        (window as unknown as Record<string, unknown>).__LIBRARIUM_LOCAL_TRANSPORT__
    ) {
        return localTransport;
    }
    return httpTransport;
}

let activeTransport: Transport = resolveDefaultTransport();

/**
 * Override the transport `request()` uses. Exposed so tests (and eventually
 * the mobile shell's own bootstrap) can select explicitly rather than
 * relying on environment sniffing.
 */
export function setTransport(transport: Transport): void {
    activeTransport = transport;
}

export function getTransport(): Transport {
    return activeTransport;
}

function requestPath(url: string): string {
    return url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
}

function isAuthLifecyclePath(path: string): boolean {
    return path === '/api/auth/login' ||
        path === '/api/auth/refresh' ||
        path === '/api/auth/logout' ||
        path === '/api/auth/totp/login-verify' ||
        path === '/api/auth/oidc/callback';
}

async function ensureFreshForRequest(url: string) {
    // The local transport has no token-based auth lifecycle at all — the
    // remote's API key lives in Rust secure storage (#54), never in the
    // WebView — so there is nothing to refresh and no HTTP call to make.
    if (activeTransport !== httpTransport) return;
    if (isAuthLifecyclePath(requestPath(url))) return;
    try {
        const auth = useAuthStore();
        await auth.ensureFresh();
    } catch {
        // Let the request proceed; the 401 handler below owns logout/redirect.
    }
}

async function handleUnauthorized(url: string) {
    if (isAuthLifecyclePath(requestPath(url))) return;
    // Import at call-time so the client module doesn't hard-require the
    // logger during the tiny build step (Vitest mocks the tauri isTauri).
    try {
        const { getLogger } = await import('@/utils/logger');
        getLogger('apiClient').warn('handleUnauthorized (401) → forcing logout + /login', {
            url: requestPath(url),
        });
    } catch { /* logging must never break the 401 flow */ }
    try {
        const auth = useAuthStore();
        await auth.logout();
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
        }
    } catch {
        // Ignore errors during logout/redirect
    }
}

// Handles 403 responses with known structured error codes so the user is
// redirected to the correct page rather than seeing a generic error.
//
// TOTP_VERIFICATION_REQUIRED: the access token was issued before TOTP
//   verification completed (e.g. stale tab after page reload). Re-arm the
//   pendingTotp flag and redirect to /login so the TOTP form is shown.
//
// PASSWORD_CHANGE_REQUIRED: an admin forced a password reset. Redirect to
//   /change-password; the router guard will enforce this on navigation too,
//   but mid-session API calls need the same treatment.
function handleForbidden(errorCode: string | undefined) {
    if (typeof window === 'undefined') return;
    try {
        const auth = useAuthStore();
        if (errorCode === 'TOTP_VERIFICATION_REQUIRED') {
            auth.flagPendingTotp();
            if (window.location.pathname !== '/login') {
                window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
            }
        } else if (errorCode === 'PASSWORD_CHANGE_REQUIRED') {
            if (window.location.pathname !== '/change-password') {
                window.location.href = '/change-password';
            }
        }
    } catch {
        // Pinia may not be ready during early boot.
    }
}

async function request<T>(
    url: string,
    options: RequestInit = {},
): Promise<T> {
    await ensureFreshForRequest(url);

    let authHeader: Record<string, string> = {};
    try {
        const auth = useAuthStore();
        const token = auth.accessToken;
        if (token) {
            authHeader = { Authorization: `Bearer ${token}` };
        }
    } catch {
        // Pinia not initialized yet (SSR guard or early boot) — skip auth header.
    }

    const response = await activeTransport(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...authHeader,
            ...(options.headers ?? {}),
        },
    });

    if (!response.ok) {
        let body: unknown;
        try { body = await response.json(); } catch { /* empty */ }
        const message = (body as { message?: string })?.message ?? `HTTP ${response.status}`;
        const errorCode = (body as { error?: string })?.error;

        if (response.status === 401) {
            await handleUnauthorized(url);
        } else if (response.status === 403) {
            handleForbidden(errorCode);
        }

        throw new ApiError(response.status, message, body);
    }

    if (response.status === 204) return undefined as unknown as T;

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
        return response.json() as Promise<T>;
    }

    const text = await response.text();
    return text as unknown as T;
}

async function getAuthHeaders(url: string): Promise<Record<string, string>> {
    await ensureFreshForRequest(url);
    try {
        const auth = useAuthStore();
        if (auth.accessToken) {
            return { Authorization: `Bearer ${auth.accessToken}` };
        }
    } catch {
        // Pinia may not be initialized yet.
    }
    return {};
}

// ── Vaults ───────────────────────────────────────────────────────────────────

export const apiListVaults = (): Promise<Vault[]> =>
    request('/api/vaults');

export const apiCreateVault = (data: CreateVaultRequest): Promise<Vault> =>
    request('/api/vaults', { method: 'POST', body: JSON.stringify(data) });

export const apiGetVault = (id: string): Promise<Vault> =>
    request(`/api/vaults/${id}`);

export const apiDeleteVault = (id: string): Promise<void> =>
    request(`/api/vaults/${id}`, { method: 'DELETE' });

// ── Files ─────────────────────────────────────────────────────────────────────

export const apiGetFileTree = (vaultId: string): Promise<FileNode[]> =>
    request(`/api/vaults/${vaultId}/files`);

export const apiReadFile = (vaultId: string, filePath: string): Promise<FileContent> =>
    request(`/api/vaults/${vaultId}/files/${filePath}`);

export const apiWriteFile = (
    vaultId: string,
    filePath: string,
    data: UpdateFileRequest,
): Promise<FileContent> =>
    request(`/api/vaults/${vaultId}/files/${filePath}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });

export const apiCreateFile = (
    vaultId: string,
    data: CreateFileRequest,
): Promise<FileContent> =>
    request(`/api/vaults/${vaultId}/files`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiDeleteFile = (vaultId: string, filePath: string): Promise<void> =>
    request(`/api/vaults/${vaultId}/files/${filePath}`, { method: 'DELETE' });

export const apiCreateDirectory = (vaultId: string, path: string): Promise<void> =>
    request(`/api/vaults/${vaultId}/directories`, {
        method: 'POST',
        body: JSON.stringify({ path }),
    });

export const apiRenameFile = (
    vaultId: string,
    from: string,
    to: string,
    // Frontend uses 'rename' as the name for auto-rename; backend calls it 'autorename'.
    strategy: 'fail' | 'overwrite' | 'rename' = 'fail',
): Promise<{ new_path: string }> =>
    request(`/api/vaults/${vaultId}/rename`, {
        method: 'POST',
        body: JSON.stringify({ from, to, strategy: strategy === 'rename' ? 'autorename' : strategy }),
    });

// ── Raw / Assets ─────────────────────────────────────────────────────────────
//
// Direct-URL inventory (#55 acceptance criterion): these build a path for a
// consumer to hand straight to the browser (`<img src>`, background-image,
// direct navigation) rather than fetching through `request()`/the transport.
// Under the local transport there is no HTTP server for the WebView to
// navigate to at all, so this needs its own strategy — the Tauri asset
// protocol (a `librarium://` custom scheme resolved on the Rust side) rather
// than a URL string — to be designed and implemented in #56.
export const apiRawFileUrl = (vaultId: string, filePath: string): string =>
    `/api/vaults/${vaultId}/raw/${filePath}`;

export const apiThumbnailUrl = (
    vaultId: string,
    filePath: string,
    width = 200,
    height = 200,
): string =>
    `/api/vaults/${vaultId}/thumbnail/${filePath}?width=${width}&height=${height}`;

// ── Search ────────────────────────────────────────────────────────────────────

export const apiSearch = (
    vaultId: string,
    query: string,
    page = 1,
    pageSize = 50,
): Promise<PagedSearchResult> =>
    request(
        `/api/vaults/${vaultId}/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
    );

export const apiTriggerReindex = (vaultId: string): Promise<{ message: string; vault_id: string }> =>
    request(`/api/vaults/${vaultId}/reindex`, { method: 'POST' });

// ── ML (outline + organization suggestions, suggest-only) ───────────────────

export const apiGenerateOutline = (
    vaultId: string,
    data: GenerateOutlineRequest,
): Promise<NoteOutlineResponse> =>
    request(`/api/vaults/${vaultId}/ml/outline`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiAnalyzeNote = (
    vaultId: string,
    data: AnalyzeNoteRequest,
): Promise<NoteAnalysis> =>
    request(`/api/vaults/${vaultId}/ml/analyze`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiGenerateOrganizationSuggestions = (
    vaultId: string,
    data: GenerateOrganizationSuggestionsRequest,
): Promise<OrganizationSuggestionsResponse> =>
    request(`/api/vaults/${vaultId}/ml/suggestions`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiRenameSuggestion = (
    vaultId: string,
    data: RenameSuggestionRequest,
): Promise<RenameSuggestionResponse> =>
    request(`/api/vaults/${vaultId}/ml/rename-suggestion`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiApplyOrganizationSuggestion = (
    vaultId: string,
    filePath: string,
    suggestion: OrganizationSuggestion,
    dryRun = true,
): Promise<ApplyOrganizationSuggestionResponse> =>
    request(`/api/vaults/${vaultId}/ml/apply-suggestion`, {
        method: 'POST',
        body: JSON.stringify({
            file_path: filePath,
            suggestion,
            dry_run: dryRun,
        }),
    });

export const apiUndoMlAction = (
    vaultId: string,
    receiptId: string,
): Promise<UndoMlActionResponse> =>
    request(`/api/vaults/${vaultId}/ml/undo`, {
        method: 'POST',
        body: JSON.stringify({ receipt_id: receiptId }),
    });

/// Undo a whole apply-plan batch by its group id.
export const apiUndoMlGroup = (
    vaultId: string,
    groupId: string,
): Promise<UndoMlActionResponse> =>
    request(`/api/vaults/${vaultId}/ml/undo`, {
        method: 'POST',
        body: JSON.stringify({ group_id: groupId }),
    });

export const apiOrganizeVault = (
    vaultId: string,
    data: OrganizeVaultRequest = {},
): Promise<OrganizationPlan> =>
    request(`/api/vaults/${vaultId}/ml/organize-vault`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiApplyPlan = (
    vaultId: string,
    data: ApplyPlanRequest,
): Promise<ApplyPlanResponse> =>
    request(`/api/vaults/${vaultId}/ml/apply-plan`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

// ── Markdown ──────────────────────────────────────────────────────────────────

export const apiRenderMarkdown = (content: string): Promise<string> =>
    request<string>('/api/render', {
        method: 'POST',
        body: JSON.stringify({ content }),
    });

export const apiRenderMarkdownInVault = (
    vaultId: string,
    content: string,
    currentFile?: string,
): Promise<string> =>
    request<string>(`/api/vaults/${vaultId}/render`, {
        method: 'POST',
        body: JSON.stringify({ content, current_file: currentFile }),
    });

// ── Resolve wiki link ─────────────────────────────────────────────────────────

export const apiResolveWikiLink = (
    vaultId: string,
    link: string,
    currentFile?: string,
): Promise<{ path: string; exists: boolean; ambiguous: boolean; alternatives: string[] }> =>
    request(`/api/vaults/${vaultId}/resolve-link`, {
        method: 'POST',
        body: JSON.stringify({ link, current_file: currentFile }),
    });

// ── Special notes ─────────────────────────────────────────────────────────────

export const apiGetRandomNote = (vaultId: string): Promise<{ path: string }> =>
    request(`/api/vaults/${vaultId}/random`);

export const apiGetDailyNote = (
    vaultId: string,
    date: string,
): Promise<FileContent> =>
    request(`/api/vaults/${vaultId}/daily`, {
        method: 'POST',
        body: JSON.stringify({ date }),
    });

// ── Preferences ───────────────────────────────────────────────────────────────

export const apiGetPreferences = (): Promise<UserPreferences> =>
    request('/api/preferences');

export const apiUpdatePreferences = (prefs: UserPreferences): Promise<UserPreferences> =>
    request('/api/preferences', { method: 'PUT', body: JSON.stringify(prefs) });

export const apiResetPreferences = (): Promise<UserPreferences> =>
    request('/api/preferences/reset', { method: 'POST' });

// ── Recent files ──────────────────────────────────────────────────────────────

export const apiGetRecentFiles = (vaultId: string): Promise<string[]> =>
    request(`/api/vaults/${vaultId}/recent`);

export const apiRecordRecentFile = (vaultId: string, path: string): Promise<void> => {
    void request(`/api/vaults/${vaultId}/recent`, {
        method: 'POST',
        body: JSON.stringify({ path }),
    });
    return Promise.resolve();
};

// ── Upload ────────────────────────────────────────────────────────────────────

export const apiCreateUploadSession = (
    vaultId: string,
    filename: string,
    totalSize: number,
    path = '',
): Promise<UploadSessionResponse> =>
    request(`/api/vaults/${vaultId}/upload-sessions`, {
        method: 'POST',
        body: JSON.stringify({ filename, total_size: totalSize, path }),
    });

// Direct-URL inventory (#55 acceptance criterion), continued: `apiUploadChunk`,
// `apiDownloadZip`, `apiDownloadTar`, and `apiImportArchive` below all call
// `fetch` directly rather than going through `request()`/the transport —
// they need binary request/response bodies (`Blob`, `File`, chunked PUT)
// that the current `TransportResponseLike` shape doesn't model. They are not
// yet transport-abstracted; #56/#57's local dispatcher needs its own
// streaming/binary strategy for these (Tauri's IPC can carry bytes, but not
// via this file's `Transport` type as written), tracked alongside the
// asset-protocol work for the plain URL builders above.
export const apiUploadChunk = (
    vaultId: string,
    sessionId: string,
    chunk: Blob,
): Promise<{ uploaded_bytes: number }> => {
    const url = `/api/vaults/${vaultId}/upload-sessions/${sessionId}`;
    return getAuthHeaders(url).then((authHeaders) => fetch(url, {
        method: 'PUT',
        headers: authHeaders,
        body: chunk,
    })).then(async (r) => {
        if (!r.ok) {
            let body: unknown;
            try { body = await r.json(); } catch { /* empty */ }
            const message = (body as { error?: string })?.error ?? `HTTP ${r.status}`;
            if (r.status === 401) await handleUnauthorized(url);
            throw new ApiError(r.status, message, body);
        }
        return r.json();
    });
};

export const apiGetUploadSessionStatus = (
    vaultId: string,
    sessionId: string,
): Promise<UploadSessionResponse> =>
    request(`/api/vaults/${vaultId}/upload-sessions/${sessionId}`);

export const apiFinishUploadSession = (
    vaultId: string,
    sessionId: string,
    filename: string,
    path = '',
    conflict: 'fail' | 'overwrite' | 'skip' | 'rename_with_timestamp' = 'rename_with_timestamp',
): Promise<ImportResultItem> =>
    request(`/api/vaults/${vaultId}/upload-sessions/${sessionId}/finish`, {
        method: 'POST',
        body: JSON.stringify({ filename, path, conflict }),
    });

// Direct-URL, same as apiRawFileUrl/apiThumbnailUrl above — needs the Tauri
// asset-protocol strategy from #56 rather than a URL string, under local.
export const apiDownloadFileUrl = (vaultId: string, filePath: string): string =>
    `/api/vaults/${vaultId}/download/${filePath}`;

export const apiDownloadZip = async (vaultId: string, paths: string[]): Promise<Blob> => {
    const url = `/api/vaults/${vaultId}/download-zip`;
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders(url)) },
        body: JSON.stringify({ paths }),
    }).then(async (r) => {
        if (r.status === 401) await handleUnauthorized(url);
        if (!r.ok) throw new ApiError(r.status, 'Failed to download zip');
        return r.blob();
    });
};

export const apiDownloadTar = async (vaultId: string, paths: string[]): Promise<Blob> => {
    const url = `/api/vaults/${vaultId}/download-tar`;
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders(url)) },
        body: JSON.stringify({ paths }),
    }).then(async (r) => {
        if (r.status === 401) await handleUnauthorized(url);
        if (!r.ok) throw new ApiError(r.status, 'Failed to download tar');
        return r.blob();
    });
};

export const apiImportArchive = (
    vaultId: string,
    archiveFile: File,
    targetPath = '',
    conflict: 'fail' | 'overwrite' | 'skip' | 'rename_with_timestamp' = 'rename_with_timestamp',
): Promise<{ extracted: string[]; count: number; skipped: string[]; skipped_count: number }> => {
    const archiveType = archiveFile.name.endsWith('.tar.gz') || archiveFile.name.endsWith('.tgz')
        ? 'tar.gz'
        : archiveFile.name.endsWith('.tar')
            ? 'tar'
            : 'zip';
    const params = new URLSearchParams({ path: targetPath, archive_type: archiveType, conflict });
    const url = `/api/vaults/${vaultId}/import-archive?${params}`;
    return getAuthHeaders(url).then((authHeaders) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
        body: archiveFile,
    })).then(async (r) => {
        if (!r.ok) {
            let body: unknown;
            try { body = await r.json(); } catch { /* empty */ }
            const message = (body as { error?: string })?.error ?? `HTTP ${r.status}`;
            if (r.status === 401) await handleUnauthorized(url);
            throw new ApiError(r.status, message, body);
        }
        return r.json();
    });
};

// ── Plugins ───────────────────────────────────────────────────────────────────

export const apiListPlugins = (): Promise<{ plugins: unknown[] }> =>
    request('/api/plugins');

export const apiTogglePlugin = (
    pluginId: string,
    enabled: boolean,
): Promise<{ success: boolean; plugin_id: string; enabled: boolean }> =>
    request(`/api/plugins/${pluginId}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
    });

// ── Auth ─────────────────────────────────────────────────────────────────────

export const apiLogin = (username: string, password: string): Promise<LoginResponse> =>
    request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });

// Browser build: the refresh token travels in the HttpOnly cookie, so `token`
// is null and we send an empty body — the browser attaches the cookie for us.
// Desktop (Tauri) build: the WebView doesn't persist the cookie reliably across
// restarts, so we pass the persisted token in the body; the server accepts
// either (see backend `refresh_token_from`).
export const apiRefreshToken = (token?: string | null): Promise<LoginResponse> =>
    request('/api/auth/refresh', {
        method: 'POST',
        ...(token ? { body: JSON.stringify({ refresh_token: token }) } : {}),
    });

// Passing `token` scopes the revoke to THIS session; omitting it triggers the
// server's "logout everywhere" contract for the user.
export const apiLogout = (token?: string | null): Promise<void> =>
    request('/api/auth/logout', {
        method: 'POST',
        ...(token ? { body: JSON.stringify({ refresh_token: token }) } : {}),
    });

export const apiVerifyTotpLogin = (code: string): Promise<TotpLoginVerifyResponse> =>
    request('/api/auth/totp/login-verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
    });

// Complete an OIDC login: the provider redirected back with a code + state,
// which the server exchanges for tokens (validating the state CSRF cookie it set
// during authorize). Returns the same token payload as a password login.
export const apiOidcCallback = (code: string, state: string): Promise<LoginResponse> =>
    request(
        `/api/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );

export const apiMe = (): Promise<AuthenticatedUserProfile> =>
    request('/api/auth/me');

export const apiChangePassword = (data: ChangePasswordRequest): Promise<{ success: boolean }> =>
    request('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiListApiKeys = (): Promise<ApiKeyInfo[]> =>
    request('/api/auth/api-keys');

export const apiCreateApiKey = (req: CreateApiKeyRequest): Promise<CreateApiKeyResponse> =>
    request('/api/auth/api-keys', { method: 'POST', body: JSON.stringify(req) });

export const apiRevokeApiKey = (keyId: string): Promise<void> =>
    request(`/api/auth/api-keys/${keyId}`, { method: 'DELETE' });

// ── Admin ────────────────────────────────────────────────────────────────────

export const apiListUsers = (): Promise<AdminUser[]> =>
    request('/api/admin/users');

export const apiCreateUser = (data: CreateUserRequest): Promise<CreateUserResponse> =>
    request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
    });

// ── Groups ───────────────────────────────────────────────────────────────────

export const apiListGroups = (): Promise<GroupInfo[]> =>
    request('/api/groups');

export const apiCreateGroup = (data: CreateGroupRequest): Promise<GroupInfo> =>
    request('/api/groups', {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiListGroupMembers = (groupId: string): Promise<GroupMember[]> =>
    request(`/api/groups/${groupId}/members`);

export const apiAddGroupMember = (
    groupId: string,
    data: AddGroupMemberRequest,
): Promise<GroupMember[]> =>
    request(`/api/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiRemoveGroupMember = (groupId: string, userId: string): Promise<void> =>
    request(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' });

// ── Bookmarks ─────────────────────────────────────────────────────────────────

export const apiListBookmarks = (vaultId: string): Promise<Bookmark[]> =>
    request(`/api/vaults/${vaultId}/bookmarks`);

export const apiCreateBookmark = (
    vaultId: string,
    path: string,
    title: string,
): Promise<Bookmark> =>
    request(`/api/vaults/${vaultId}/bookmarks`, {
        method: 'POST',
        body: JSON.stringify({ path, title }),
    });

export const apiDeleteBookmark = (vaultId: string, bookmarkId: string): Promise<void> =>
    request(`/api/vaults/${vaultId}/bookmarks/${bookmarkId}`, { method: 'DELETE' });

// ── Favorites ─────────────────────────────────────────────────────────────────

export const apiListFavorites = (vaultId: string): Promise<Favorite[]> =>
    request(`/api/vaults/${vaultId}/favorites`);

export const apiAddFavorite = (vaultId: string, path: string): Promise<Favorite> =>
    request(`/api/vaults/${vaultId}/favorites`, {
        method: 'POST',
        body: JSON.stringify({ path }),
    });

export const apiRemoveFavorite = (vaultId: string, path: string): Promise<void> =>
    request(
        `/api/vaults/${vaultId}/favorites?path=${encodeURIComponent(path)}`,
        { method: 'DELETE' },
    );

// ── Tags ──────────────────────────────────────────────────────────────────────

export const apiListTags = (vaultId: string): Promise<TagEntry[]> =>
    request(`/api/vaults/${vaultId}/tags`);

export const apiDeleteTag = (
    vaultId: string,
    tag: string,
    dryRun = false,
): Promise<{ tag: string; dry_run: boolean; count: number; files_modified: number; files: string[]; group_id?: string | null }> =>
    request(
        `/api/vaults/${vaultId}/tags/${encodeURIComponent(tag)}${dryRun ? '?dry_run=true' : ''}`,
        { method: 'DELETE' },
    );

// ── Backlinks ─────────────────────────────────────────────────────────────────

export const apiGetBacklinks = (vaultId: string, path: string): Promise<BacklinkEntry[]> =>
    request(`/api/vaults/${vaultId}/backlinks?path=${encodeURIComponent(path)}`);

// ── Vault sharing ────────────────────────────────────────────────────────────

export const apiListVaultShares = (vaultId: string): Promise<VaultShareList> =>
    request(`/api/vaults/${vaultId}/shares`);

export const apiShareVaultWithUser = (
    vaultId: string,
    data: ShareVaultWithUserRequest,
): Promise<VaultShareList> =>
    request(`/api/vaults/${vaultId}/shares/users`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiShareVaultWithGroup = (
    vaultId: string,
    data: ShareVaultWithGroupRequest,
): Promise<VaultShareList> =>
    request(`/api/vaults/${vaultId}/shares/groups`, {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const apiRevokeVaultUserShare = (
    vaultId: string,
    userId: string,
): Promise<VaultShareList> =>
    request(`/api/vaults/${vaultId}/shares/users/${userId}`, {
        method: 'DELETE',
    });

export const apiRevokeVaultGroupShare = (
    vaultId: string,
    groupId: string,
): Promise<VaultShareList> =>
    request(`/api/vaults/${vaultId}/shares/groups/${groupId}`, {
        method: 'DELETE',
    });

// ── Entities & Schema ─────────────────────────────────────────────────────────

export interface EntityListParams {
    entity_type?: string;
    label?: string;
    plugin?: string;
    q?: string;
}

export const apiListEntities = (vaultId: string, params?: EntityListParams): Promise<{ entities: Entity[] }> => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString() : '';
    return request(`/api/vaults/${vaultId}/entities${qs ? `?${qs}` : ''}`);
};

export const apiGetEntity = (vaultId: string, entityId: string): Promise<Entity> =>
    request(`/api/vaults/${vaultId}/entities/${entityId}`);

export const apiGetEntityRelations = (vaultId: string, entityId: string): Promise<{ relations: EntityRelation[] }> =>
    request(`/api/vaults/${vaultId}/entities/${entityId}/relations`);

export const apiGetGraph = (vaultId: string): Promise<GraphData> =>
    request(`/api/vaults/${vaultId}/graph`);

export const apiListLabels = (): Promise<{ labels: Array<{ name: string; description?: string }> }> =>
    request('/api/plugins/labels');

export const apiListEntityTypes = (): Promise<{ entity_types: EntityTypeSchema[] }> =>
    request('/api/plugins/entity-types');

export const apiGetEntityTypeTemplate = (vaultId: string, typeId: string): Promise<{ content: string }> =>
    request(`/api/vaults/${encodeURIComponent(vaultId)}/entity-template?type=${encodeURIComponent(typeId)}`);

export const apiListRelationTypes = (): Promise<{ relation_types: RelationTypeSchema[] }> =>
    request('/api/plugins/relation-types');

export const apiGetEntityByPath = (
    vaultId: string,
    filePath: string,
): Promise<{ entity: Entity | null; relations: EntityRelation[] }> =>
    request(`/api/vaults/${encodeURIComponent(vaultId)}/entity-by-path?path=${encodeURIComponent(filePath)}`);

export interface VaultEntityStats {
    vault_id: string;
    vault_name: string;
    entity_count: number;
    relation_count: number;
    last_reindexed?: string;
    reindex_file_count?: number;
    reindex_duration_ms?: number;
}

export const apiGetEntityIndexStats = (): Promise<{ vaults: VaultEntityStats[] }> =>
    request('/api/admin/entity-index-stats');
