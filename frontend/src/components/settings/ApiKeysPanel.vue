<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-4">
      <div>
        <h2 class="text-h6 mb-1">API Keys</h2>
        <p class="text-body-2 text-medium-emphasis">
          Create and manage API keys for programmatic access.
        </p>
      </div>
      <div class="d-flex ga-2">
        <v-btn variant="outlined" :loading="loading" @click="loadKeys">Refresh</v-btn>
        <v-btn color="primary" @click="openCreateDialog">Create API key</v-btn>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-alert v-if="createdKey" type="warning" variant="tonal" class="mb-3" data-testid="api-key-reveal">
      <p class="font-weight-bold mb-1">
        Copy your new API key now — it will not be shown again.
      </p>
      <div class="d-flex align-center ga-2">
        <code class="pa-2 flex-grow-1" style="overflow-wrap: anywhere; user-select: all;">{{ createdKey }}</code>
        <v-btn size="small" variant="tonal" :color="copied ? 'success' : undefined" @click="copyCreatedKey">
          {{ copied ? 'Copied' : 'Copy' }}
        </v-btn>
      </div>
      <div class="text-right mt-2">
        <v-btn size="small" variant="text" @click="createdKey = ''">Dismiss</v-btn>
      </div>
    </v-alert>

    <v-card>
      <v-data-table
        :headers="headers"
        :items="apiKeys"
        :loading="loading"
        item-key="id"
        density="comfortable"
      >
        <template #item.name="{ item }">
          <span :class="{ 'text-medium-emphasis text-decoration-line-through': item.revoked }">
            {{ item.name }}
          </span>
          <v-chip v-if="item.revoked" size="x-small" color="error" variant="tonal" class="ml-2">
            Revoked
          </v-chip>
        </template>

        <template #item.prefix="{ item }">
          <code>obh_{{ item.prefix }}…</code>
        </template>

        <template #item.created_at="{ item }">
          {{ formatDate(item.created_at) }}
        </template>

        <template #item.expires_at="{ item }">
          {{ item.expires_at ? formatDate(item.expires_at) : 'Never' }}
        </template>

        <template #item.actions="{ item }">
          <v-btn
            size="small"
            variant="tonal"
            color="error"
            :disabled="item.revoked"
            :loading="revokingId === item.id"
            @click="revokeKey(item)"
          >
            Revoke
          </v-btn>
        </template>

        <template #no-data>
          <div class="text-medium-emphasis pa-4">No API keys yet.</div>
        </template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="showCreateDialog" max-width="480">
      <v-card>
        <v-card-title>Create API key</v-card-title>
        <v-card-text>
          <v-alert v-if="createError" type="error" variant="tonal" class="mb-3">
            {{ createError }}
          </v-alert>
          <v-text-field
            v-model="newName"
            label="Name"
            hint="A label to help you identify this key later"
            persistent-hint
            autofocus
            class="mb-2"
          />
          <v-text-field
            v-model="newExpiresInDays"
            label="Expires in (days, optional)"
            type="number"
            min="1"
            hint="Leave blank for a key that never expires"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeCreateDialog">Cancel</v-btn>
          <v-btn color="primary" :disabled="!newName.trim()" :loading="creating" @click="createKey">
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiCreateApiKey, apiListApiKeys, apiRevokeApiKey } from '@/api/client';
import type { ApiKeyInfo } from '@/api/types';

const apiKeys = ref<ApiKeyInfo[]>([]);
const loading = ref(false);
const error = ref('');

const revokingId = ref<string | null>(null);

const showCreateDialog = ref(false);
const newName = ref('');
const newExpiresInDays = ref('');
const creating = ref(false);
const createError = ref('');

const createdKey = ref('');
const copied = ref(false);

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Prefix', key: 'prefix' },
  { title: 'Created', key: 'created_at' },
  { title: 'Expires', key: 'expires_at' },
  { title: '', key: 'actions', sortable: false },
] as const;

onMounted(() => {
  void loadKeys();
});

async function loadKeys() {
  loading.value = true;
  error.value = '';
  try {
    apiKeys.value = await apiListApiKeys();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load API keys.';
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  newName.value = '';
  newExpiresInDays.value = '';
  createError.value = '';
  showCreateDialog.value = true;
}

function closeCreateDialog() {
  showCreateDialog.value = false;
}

async function createKey() {
  const name = newName.value.trim();
  if (!name) return;

  createError.value = '';
  creating.value = true;
  try {
    const daysRaw = newExpiresInDays.value.trim();
    const expiresInDays = daysRaw ? Number(daysRaw) : undefined;

    const created = await apiCreateApiKey({
      name,
      expires_in_days: expiresInDays,
    });

    createdKey.value = created.api_key;
    copied.value = false;
    showCreateDialog.value = false;

    await loadKeys();
  } catch (e: any) {
    createError.value = e?.message ?? 'Failed to create API key.';
  } finally {
    creating.value = false;
  }
}

async function copyCreatedKey() {
  if (!createdKey.value) return;
  try {
    await navigator.clipboard.writeText(createdKey.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to copy API key to clipboard.';
  }
}

async function revokeKey(key: ApiKeyInfo) {
  if (!confirm(`Revoke API key "${key.name}"? Any application using it will lose access immediately.`)) {
    return;
  }

  revokingId.value = key.id;
  error.value = '';
  try {
    await apiRevokeApiKey(key.id);
    await loadKeys();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to revoke API key.';
  } finally {
    revokingId.value = null;
  }
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}
</script>
