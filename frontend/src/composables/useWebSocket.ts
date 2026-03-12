import { ref, onUnmounted } from 'vue';
import type { WsMessage, FileChangeType } from '@/api/types';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { useVaultsStore } from '@/stores/vaults';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
const MAX_RECONNECT_DELAY_MS = 30_000;

// Module-level singleton so only one WS connection exists regardless of how many
// components call useWebSocket().
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const connected = ref(false);

function getReconnectDelay(): number {
    return Math.min(1_000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
}

function handleMessage(event: MessageEvent) {
    let msg: WsMessage;
    try {
        msg = JSON.parse(event.data as string) as WsMessage;
    } catch {
        return;
    }

    switch (msg.type) {
        case 'FileChanged': {
            const filesStore = useFilesStore();
            const tabsStore = useTabsStore();
            const vaultsStore = useVaultsStore();

            // Refresh the file tree for the affected vault
            if (vaultsStore.activeVaultId === msg.vault_id) {
                void filesStore.loadTree(msg.vault_id);
            }

            // If the changed file is open in a tab and not dirty, reload it
            tabsStore.tabs.forEach((tab, tabId) => {
                if (tab.filePath === msg.path && !tab.isDirty) {
                    void filesStore.readFile(msg.vault_id, msg.path).then((fc) => {
                        const t = tabsStore.tabs.get(tabId);
                        if (t && !t.isDirty) {
                            t.content = fc.content;
                            t.modified = fc.modified;
                            t.frontmatter = fc.frontmatter;
                        }
                    });
                }
            });
            break;
        }
        case 'SyncPing':
        case 'SyncPong':
            // Reserved for desktop sync heartbeat handling.
            break;
        case 'Error':
            console.warn('WebSocket error from server:', msg.message);
            break;
    }
}

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
        connected.value = true;
        reconnectAttempts = 0;
    });

    ws.addEventListener('message', handleMessage);

    ws.addEventListener('close', () => {
        connected.value = false;
        ws = null;
        const delay = getReconnectDelay();
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, delay);
    });

    ws.addEventListener('error', () => {
        ws?.close();
    });
}

function disconnect() {
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    ws?.close();
    ws = null;
    connected.value = false;
}

export function useWebSocket() {
    // Start the connection if not already running
    connect();

    // Cleanup when the last consumer unmounts is not straightforward with a singleton,
    // so we intentionally keep the connection alive for the app lifetime.
    // disconnect() can be called explicitly (e.g. on logout).

    return { connected, disconnect };
}
