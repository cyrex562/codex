<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-3">
      <h3 class="text-subtitle-1">Sync status</h3>
      <div class="d-flex ga-2">
        <v-btn size="small" variant="tonal" color="error" :loading="stopping" data-testid="sync-status-stop-btn" @click="stop">
          Stop sync
        </v-btn>
        <v-btn size="small" color="primary" :loading="starting" data-testid="sync-status-start-btn" @click="start">
          Start sync
        </v-btn>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <p v-if="!syncStore.statuses.length" class="text-medium-emphasis text-body-2">
      No vaults are mapped to a sync remote yet.
    </p>

    <v-card
      v-for="s in syncStore.statuses"
      :key="s.local_vault_id"
      variant="outlined"
      class="mb-2 pa-3"
      data-testid="sync-status-row"
    >
      <div class="d-flex justify-space-between align-center">
        <div>
          <div class="text-body-2 font-weight-medium">{{ vaultName(s.local_vault_id) }}</div>
          <div class="text-caption text-medium-emphasis">{{ lastSyncedLabel(s.local_vault_id) }}</div>
        </div>
        <v-chip :color="stateColor(s.state)" size="small" variant="tonal" data-testid="sync-status-chip">
          <v-icon :icon="stateIcon(s.state)" start size="16" />
          {{ stateLabel(s.state) }}
        </v-chip>
      </div>

      <template v-if="s.state === 'syncing' && s.total > 0">
        <v-progress-linear
          class="mt-2"
          :model-value="(s.synced / s.total) * 100"
          height="6"
          rounded
          color="warning"
          data-testid="sync-status-progress"
        />
        <div class="text-caption text-medium-emphasis mt-1">{{ s.synced }} / {{ s.total }} files</div>
      </template>

      <v-chip v-if="s.pending_outbox > 0" size="x-small" color="warning" variant="tonal" label class="mt-2">
        {{ s.pending_outbox }} pending
      </v-chip>

      <v-alert v-if="s.last_error" type="error" variant="tonal" density="compact" class="mt-2">
        {{ s.last_error }}
      </v-alert>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSyncStore } from '@/stores/sync';
import { useVaultsStore } from '@/stores/vaults';
import { stateColor, stateLabel, stateIcon } from '@/utils/syncStateDisplay';

const syncStore = useSyncStore();
const vaultsStore = useVaultsStore();

const starting = ref(false);
const stopping = ref(false);
const error = ref('');

function vaultName(id: string): string {
  return vaultsStore.vaults.find((v) => v.id === id)?.name ?? id;
}

function lastSyncedLabel(id: string): string {
  const iso = syncStore.lastSyncedAt[id];
  return iso ? `Last synced ${new Date(iso).toLocaleString()}` : 'Not yet synced';
}

async function start() {
  starting.value = true;
  error.value = '';
  try {
    await syncStore.startSync();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to start sync.';
  } finally {
    starting.value = false;
  }
}

async function stop() {
  stopping.value = true;
  error.value = '';
  try {
    await syncStore.stopSync();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to stop sync.';
  } finally {
    stopping.value = false;
  }
}
</script>
