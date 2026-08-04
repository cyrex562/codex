<template>
  <div>
    <v-alert v-if="!tauriAvailable" type="info" variant="tonal">
      Sync is only available in the desktop app.
    </v-alert>

    <template v-else>
      <div class="d-flex justify-space-between align-center mb-4">
        <div>
          <h2 class="text-h6 mb-1">Sync Remotes</h2>
          <p class="text-body-2 text-medium-emphasis">
            Manage the servers this vault can synchronise with.
          </p>
        </div>
        <div class="d-flex ga-2">
          <v-btn variant="outlined" :loading="loading" @click="loadRemotes">Refresh</v-btn>
          <v-btn color="primary" @click="openAddDialog">Add remote</v-btn>
        </div>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-3" closable @click:close="error = ''">
        {{ error }}
      </v-alert>

      <v-card>
        <v-data-table
          :headers="headers"
          :items="remotes"
          :loading="loading"
          item-key="id"
          density="comfortable"
        >
          <template #item.enabled="{ item }">
            <v-chip :color="item.enabled ? 'success' : 'default'" size="small" variant="tonal">
              {{ item.enabled ? 'Enabled' : 'Disabled' }}
            </v-chip>
          </template>

          <template #item.actions="{ item }">
            <v-btn
              size="small"
              variant="tonal"
              color="error"
              :loading="removingId === item.id"
              @click="removeRemote(item)"
            >
              Remove
            </v-btn>
          </template>

          <template #no-data>
            <div class="text-medium-emphasis pa-4">No sync remotes configured.</div>
          </template>
        </v-data-table>
      </v-card>

      <v-dialog v-model="showAddDialog" max-width="480">
        <v-card>
          <v-card-title>Add remote</v-card-title>
          <v-card-text>
            <v-alert v-if="addError" type="error" variant="tonal" class="mb-3">
              {{ addError }}
            </v-alert>
            <v-text-field
              v-model="newBaseUrl"
              label="Server URL"
              hint="e.g. https://sync.example.com"
              persistent-hint
              autofocus
              class="mb-2"
            />
            <v-text-field
              v-model="newApiKey"
              label="API key"
              :type="showApiKey ? 'text' : 'password'"
              :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append-inner="showApiKey = !showApiKey"
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="closeAddDialog">Cancel</v-btn>
            <v-btn
              color="primary"
              :disabled="!newBaseUrl.trim() || !newApiKey.trim()"
              :loading="adding"
              @click="addRemote"
            >
              Add
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  isTauri,
  syncAddRemote,
  syncListRemotes,
  syncRemoveRemote,
  tauriErrorMessage,
} from '@/utils/tauri';
import type { SyncRemoteDto } from '@/utils/tauri';

const emit = defineEmits<{ (e: 'changed'): void }>();

const tauriAvailable = isTauri();

const remotes = ref<SyncRemoteDto[]>([]);
const loading = ref(false);
const error = ref('');

const removingId = ref<string | null>(null);

const showAddDialog = ref(false);
const newBaseUrl = ref('');
const newApiKey = ref('');
const showApiKey = ref(false);
const adding = ref(false);
const addError = ref('');

const headers = [
  { title: 'Server URL', key: 'base_url' },
  { title: 'Status', key: 'enabled' },
  { title: '', key: 'actions', sortable: false },
] as const;

onMounted(() => {
  if (tauriAvailable) {
    void loadRemotes();
  }
});

async function loadRemotes() {
  loading.value = true;
  error.value = '';
  try {
    remotes.value = await syncListRemotes();
  } catch (e: any) {
    error.value = tauriErrorMessage(e, 'Failed to load sync remotes.');
  } finally {
    loading.value = false;
  }
}

function openAddDialog() {
  newBaseUrl.value = '';
  newApiKey.value = '';
  showApiKey.value = false;
  addError.value = '';
  showAddDialog.value = true;
}

function closeAddDialog() {
  showAddDialog.value = false;
}

async function addRemote() {
  const baseUrl = newBaseUrl.value.trim();
  const apiKey = newApiKey.value.trim();
  if (!baseUrl || !apiKey) return;

  addError.value = '';
  adding.value = true;
  try {
    await syncAddRemote(baseUrl, apiKey);

    newBaseUrl.value = '';
    newApiKey.value = '';
    showAddDialog.value = false;

    await loadRemotes();
    emit('changed');
  } catch (e: any) {
    addError.value = tauriErrorMessage(e, 'Failed to add sync remote.');
  } finally {
    adding.value = false;
  }
}

async function removeRemote(remote: SyncRemoteDto) {
  if (!confirm(`Remove remote "${remote.base_url}"? This will stop syncing with this server.`)) {
    return;
  }

  removingId.value = remote.id;
  error.value = '';
  try {
    await syncRemoveRemote(remote.id);
    await loadRemotes();
    emit('changed');
  } catch (e: any) {
    error.value = tauriErrorMessage(e, 'Failed to remove sync remote.');
  } finally {
    removingId.value = null;
  }
}
</script>
