import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
    pairingSet,
    pairingGet,
    pairingClear,
    syncStatus,
    syncStart,
    syncStop,
    mobileFileTree,
} from '@/utils/tauri';
import type { PairingInfo, SyncVaultStatus } from '@/utils/tauri';
import type { FileNode } from '@/api/types';

const POLL_INTERVAL_MS = 3000;

// Anything `librarium-sync`'s keep-both resolution could have written —
// broad on purpose so a file is still surfaced (with `originalPath: null`)
// even if it doesn't match the stricter convention below.
const CONFLICT_PREFIX_RE = /^conflict_/;

// `conflict_<stem>_<YYYYMMDD_HHMMSS>.<ext>`, matching
// `librarium-sync`'s `conflict_name()` (`crates/librarium-sync/src/engine.rs`)
// exactly — used only to derive the pre-conflict path, since that requires
// knowing where the stem ends and the timestamp begins.
const CONFLICT_NAME_RE = /^conflict_(.+)_(\d{8}_\d{6})(\.[^./]+)?$/;

export interface ConflictFile {
    vaultId: string;
    path: string;
    name: string;
    /** The pre-conflict path this file was split from, or `null` if the name doesn't match the expected convention. */
    originalPath: string | null;
}

function deriveOriginalPath(path: string, name: string): string | null {
    const m = name.match(CONFLICT_NAME_RE);
    if (!m) return null;
    const [, stem, , ext] = m;
    const dir = path.slice(0, path.length - name.length);
    return `${dir}${stem}${ext ?? ''}`;
}

function collectConflicts(nodes: FileNode[], vaultId: string, out: ConflictFile[]) {
    for (const node of nodes) {
        if (node.is_directory) {
            if (node.children) collectConflicts(node.children, vaultId, out);
            continue;
        }
        if (!CONFLICT_PREFIX_RE.test(node.name)) continue;
        out.push({
            vaultId,
            path: node.path,
            name: node.name,
            originalPath: deriveOriginalPath(node.path, node.name),
        });
    }
}

export const useSyncStore = defineStore('sync', () => {
    const pairing = ref<PairingInfo | null>(null);
    const pairingLoaded = ref(false);
    const statuses = ref<SyncVaultStatus[]>([]);
    // Best-effort "last synced" timestamp per local vault id, stamped
    // client-side whenever a poll observes that vault as `live` — the sync
    // engine only exposes `last_synced_seq` (a sequence number), not a wall
    // clock time, so this is the practical proxy for it.
    const lastSyncedAt = ref<Record<string, string>>({});
    const loading = ref(false);
    const error = ref<string | null>(null);
    const statusLoaded = ref(false);
    const conflictFiles = ref<ConflictFile[]>([]);

    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const isPaired = computed(() => pairing.value !== null);
    const hasAnyMapping = computed(() => statuses.value.length > 0);
    const conflictCount = computed(() => conflictFiles.value.length);

    async function loadPairing() {
        try {
            pairing.value = await pairingGet();
            error.value = null;
        } catch (e) {
            error.value = String(e);
        } finally {
            pairingLoaded.value = true;
        }
    }

    async function pair(baseUrl: string, apiKey: string) {
        loading.value = true;
        error.value = null;
        try {
            await pairingSet(baseUrl, apiKey);
            await loadPairing();
        } catch (e) {
            error.value = String(e);
            throw e;
        } finally {
            loading.value = false;
        }
    }

    async function unpair() {
        loading.value = true;
        error.value = null;
        try {
            await pairingClear();
            pairing.value = null;
            statuses.value = [];
            lastSyncedAt.value = {};
            conflictFiles.value = [];
        } catch (e) {
            error.value = String(e);
            throw e;
        } finally {
            loading.value = false;
        }
    }

    async function refreshStatus() {
        try {
            const next = await syncStatus();
            const now = new Date().toISOString();
            for (const s of next) {
                if (s.state === 'live') {
                    lastSyncedAt.value[s.local_vault_id] = now;
                }
            }
            statuses.value = next;
            error.value = null;
        } catch (e) {
            error.value = String(e);
        } finally {
            statusLoaded.value = true;
        }
    }

    function startPolling() {
        if (pollHandle !== null) return;
        void refreshStatus();
        pollHandle = setInterval(() => {
            void refreshStatus();
        }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollHandle !== null) {
            clearInterval(pollHandle);
            pollHandle = null;
        }
    }

    /**
     * Walk every mapped vault's file tree for `conflict_*` siblings. This is
     * the drift-detector's whole job: `librarium-sync` writes these files on
     * every keep-both resolution but exposes no dedicated "list conflicts"
     * command, and an ordinary filename-pattern scan over the existing
     * `file_tree` command is enough to surface them — see
     * `docs/DESIGN.md`'s Offline UX section for the full rationale. Called
     * on demand (not on the status poll interval) since it walks a full
     * tree per vault.
     */
    async function scanConflicts() {
        const files: ConflictFile[] = [];
        for (const s of statuses.value) {
            try {
                const tree = await mobileFileTree(s.local_vault_id);
                collectConflicts(tree, s.local_vault_id, files);
            } catch {
                // Best-effort — skip a vault we can't currently read rather
                // than blanking out conflicts we already know about elsewhere.
            }
        }
        conflictFiles.value = files;
    }

    async function startSync() {
        await syncStart();
        await refreshStatus();
    }

    async function stopSync() {
        await syncStop();
        await refreshStatus();
    }

    return {
        pairing,
        pairingLoaded,
        statuses,
        statusLoaded,
        lastSyncedAt,
        loading,
        error,
        isPaired,
        hasAnyMapping,
        conflictFiles,
        conflictCount,
        loadPairing,
        pair,
        unpair,
        refreshStatus,
        scanConflicts,
        startPolling,
        stopPolling,
        startSync,
        stopSync,
    };
});
