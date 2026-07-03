<template>
  <div>
    <v-alert v-if="!tauriAvailable" type="info" variant="tonal">
      Sync status is only available in the desktop app.
    </v-alert>

    <template v-else>
      <div class="d-flex justify-space-between align-center mb-4">
        <div>
          <h2 class="text-h6 mb-1">Sync Status</h2>
          <p class="text-body-2 text-medium-emphasis">
            Live status of each vault's sync connection.
          </p>
        </div>
        <div class="d-flex ga-2">
          <v-btn variant="outlined" :loading="loading" @click="refresh">Refresh</v-btn>
          <v-btn color="error" variant="tonal" :loading="stopping" @click="stopSync">Stop sync</v-btn>
          <v-btn color="primary" :loading="starting" @click="startSync">Start sync</v-btn>
        </div>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-3" closable @click:close="error = ''">
        {{ error }}
      </v-alert>

      <v-card>
        <v-data-table
          :headers="headers"
          :items="statuses"
          :loading="loading"
          item-key="local_vault_id"
          density="comfortable"
        >
          <template #item.remote_id="{ item }">
            <span class="text-mono" :title="item.remote_id">{{ shortId(item.remote_id) }}</span>
          </template>

          <template #item.local_vault_id="{ item }">
            <span class="text-mono" :title="item.local_vault_id">{{ shortId(item.local_vault_id) }}</span>
          </template>

          <template #item.state="{ item }">
            <v-chip :color="stateColor(item.state)" size="small" variant="tonal">
              {{ stateLabel(item.state) }}
              <span v-if="item.state === 'syncing' && item.total > 0">
                &nbsp;{{ item.synced }}/{{ item.total }}
              </span>
            </v-chip>
          </template>

          <template #item.last_synced_seq="{ item }">
            {{ item.last_synced_seq }}
          </template>

          <template #item.pending_outbox="{ item }">
            <v-chip
              size="x-small"
              :color="item.pending_outbox > 0 ? 'warning' : 'default'"
              variant="tonal"
              label
            >
              {{ item.pending_outbox }}
            </v-chip>
          </template>

          <template #item.last_error="{ item }">
            <v-tooltip v-if="item.last_error" location="top">
              <template #activator="{ props }">
                <span v-bind="props" class="text-error text-truncate d-inline-block" style="max-width: 240px;">
                  {{ item.last_error }}
                </span>
              </template>
              <span>{{ item.last_error }}</span>
            </v-tooltip>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <template #item.actions="{ item }">
            <v-btn
              size="small"
              variant="tonal"
              color="error"
              :loading="unmappingId === item.local_vault_id"
              @click="unmapVault(item)"
            >
              Unmap
            </v-btn>
          </template>

          <template #no-data>
            <div class="text-medium-emphasis pa-4">No vaults are mapped to a sync remote.</div>
          </template>
        </v-data-table>
      </v-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';
import { isTauri, syncStatus, syncStart, syncStop, syncUnmapVault } from '@/utils/tauri';
import type { SyncVaultStatus, SyncVaultState } from '@/utils/tauri';

const POLL_INTERVAL_MS = 3000;

const tauriAvailable = isTauri();

const statuses = ref<SyncVaultStatus[]>([]);
const loading = ref(false);
const starting = ref(false);
const stopping = ref(false);
const unmappingId = ref<string | null>(null);
const error = ref('');

let pollHandle: ReturnType<typeof setInterval> | null = null;

const headers = [
  { title: 'Remote', key: 'remote_id' },
  { title: 'Local vault', key: 'local_vault_id' },
  { title: 'State', key: 'state' },
  { title: 'Last synced seq', key: 'last_synced_seq' },
  { title: 'Pending outbox', key: 'pending_outbox' },
  { title: 'Last error', key: 'last_error' },
  { title: '', key: 'actions', sortable: false },
] as const;

onMounted(() => {
  if (!tauriAvailable) return;
  void loadStatus();
  pollHandle = setInterval(() => {
    void loadStatus();
  }, POLL_INTERVAL_MS);
});

function stopPolling() {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

onUnmounted(stopPolling);
onBeforeUnmount(stopPolling);

async function loadStatus(showSpinner = false) {
  if (showSpinner) loading.value = true;
  try {
    statuses.value = await syncStatus();
    error.value = '';
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load sync status.';
  } finally {
    if (showSpinner) loading.value = false;
  }
}

async function refresh() {
  await loadStatus(true);
}

async function startSync() {
  starting.value = true;
  error.value = '';
  try {
    await syncStart();
    await loadStatus();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to start sync.';
  } finally {
    starting.value = false;
  }
}

async function stopSync() {
  stopping.value = true;
  error.value = '';
  try {
    await syncStop();
    await loadStatus();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to stop sync.';
  } finally {
    stopping.value = false;
  }
}

async function unmapVault(item: SyncVaultStatus) {
  if (
    !confirm(
      `Unmap local vault "${shortId(item.local_vault_id)}" from remote "${shortId(item.remote_id)}"? This will stop syncing this vault.`,
    )
  ) {
    return;
  }

  unmappingId.value = item.local_vault_id;
  error.value = '';
  try {
    await syncUnmapVault(item.remote_id, item.local_vault_id);
    await loadStatus();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to unmap vault.';
  } finally {
    unmappingId.value = null;
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function stateColor(state: SyncVaultState): string {
  switch (state) {
    case 'live':
      return 'success';
    case 'syncing':
    case 'catching_up':
    case 'connecting':
      return 'warning';
    case 'offline':
    default:
      return 'default';
  }
}

function stateLabel(state: SyncVaultState): string {
  switch (state) {
    case 'syncing':
      return 'Syncing';
    case 'catching_up':
      return 'Catching up';
    case 'connecting':
      return 'Connecting';
    case 'live':
      return 'Live';
    case 'offline':
    default:
      return 'Offline';
  }
}
</script>

<style scoped>
.text-mono {
  font-family: monospace;
}
</style>
