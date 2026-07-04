<template>
  <v-alert v-if="!desktop" type="info" variant="tonal">
    Vault sync mappings are only available in the desktop app.
  </v-alert>

  <v-card v-else>
    <v-card-title class="text-subtitle-1">Map a local vault to a remote vault</v-card-title>
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-3">{{ error }}</v-alert>
      <v-alert v-if="successMessage" type="success" variant="tonal" class="mb-3">{{ successMessage }}</v-alert>

      <v-row>
        <v-col cols="12" md="6">
          <v-select
            v-model="selectedRemoteId"
            :items="remoteItems"
            item-title="title"
            item-value="value"
            label="Remote"
            density="comfortable"
            :loading="loadingRemotes"
            :disabled="loadingRemotes"
            @update:model-value="onRemoteSelected"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="selectedLocalVaultId"
            :items="localVaultItems"
            item-title="title"
            item-value="value"
            label="Local vault"
            density="comfortable"
            :loading="loadingLocalVaults"
            :disabled="loadingLocalVaults"
          />
        </v-col>
      </v-row>

      <v-row v-if="selectedRemoteId">
        <v-col cols="12" md="6">
          <v-select
            v-model="selectedRemoteVaultId"
            :items="remoteVaultItems"
            item-title="title"
            item-value="value"
            label="Remote vault"
            density="comfortable"
            :loading="loadingRemoteVaults"
            :disabled="loadingRemoteVaults"
            clearable
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="newRemoteVaultName"
            label="New remote vault name"
            density="comfortable"
          />
        </v-col>
        <v-col cols="12" md="2" class="d-flex align-center">
          <v-btn
            variant="outlined"
            :loading="creatingRemoteVault"
            :disabled="!newRemoteVaultName.trim()"
            @click="createRemoteVault"
          >
            Create vault
          </v-btn>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" class="d-flex justify-end">
          <v-btn
            color="primary"
            :loading="creatingMapping"
            :disabled="!canCreateMapping"
            @click="createMapping"
          >
            Create mapping
          </v-btn>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  isTauri,
  syncListRemotes,
  syncListRemoteVaults,
  syncCreateRemoteVault,
  syncMapVault,
} from '@/utils/tauri';
import type { SyncRemoteDto } from '@/utils/tauri';
import { apiListVaults } from '@/api/client';
import type { Vault } from '@/api/types';

const emit = defineEmits<{ (e: 'changed'): void }>();

const desktop = isTauri();

const remotes = ref<SyncRemoteDto[]>([]);
const localVaults = ref<Vault[]>([]);
const remoteVaults = ref<Vault[]>([]);

const selectedRemoteId = ref<string | null>(null);
const selectedLocalVaultId = ref<string | null>(null);
const selectedRemoteVaultId = ref<string | null>(null);
const newRemoteVaultName = ref('');

const loadingRemotes = ref(false);
const loadingLocalVaults = ref(false);
const loadingRemoteVaults = ref(false);
const creatingRemoteVault = ref(false);
const creatingMapping = ref(false);

const error = ref('');
const successMessage = ref('');

const remoteItems = computed(() =>
  remotes.value.map((r) => ({ title: r.base_url, value: r.id })),
);

const localVaultItems = computed(() =>
  localVaults.value.map((v) => ({ title: v.name, value: v.id })),
);

const remoteVaultItems = computed(() =>
  remoteVaults.value.map((v) => ({ title: v.name, value: v.id })),
);

const canCreateMapping = computed(
  () =>
    !!selectedRemoteId.value &&
    !!selectedLocalVaultId.value &&
    !!selectedRemoteVaultId.value &&
    !creatingMapping.value,
);

onMounted(() => {
  if (!desktop) return;
  void loadRemotes();
  void loadLocalVaults();
});

async function loadRemotes() {
  loadingRemotes.value = true;
  error.value = '';
  try {
    remotes.value = await syncListRemotes();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load remotes.';
  } finally {
    loadingRemotes.value = false;
  }
}

async function loadLocalVaults() {
  loadingLocalVaults.value = true;
  error.value = '';
  try {
    localVaults.value = await apiListVaults();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load local vaults.';
  } finally {
    loadingLocalVaults.value = false;
  }
}

async function onRemoteSelected(remoteId: string | null) {
  selectedRemoteVaultId.value = null;
  remoteVaults.value = [];
  if (!remoteId) return;

  loadingRemoteVaults.value = true;
  error.value = '';
  try {
    remoteVaults.value = await syncListRemoteVaults(remoteId);
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load remote vaults.';
  } finally {
    loadingRemoteVaults.value = false;
  }
}

async function createRemoteVault() {
  if (!selectedRemoteId.value || !newRemoteVaultName.value.trim()) return;

  creatingRemoteVault.value = true;
  error.value = '';
  try {
    const created = await syncCreateRemoteVault(selectedRemoteId.value, newRemoteVaultName.value.trim());
    remoteVaults.value = [...remoteVaults.value, created];
    selectedRemoteVaultId.value = created.id;
    newRemoteVaultName.value = '';
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create remote vault.';
  } finally {
    creatingRemoteVault.value = false;
  }
}

async function createMapping() {
  if (!selectedRemoteId.value || !selectedLocalVaultId.value || !selectedRemoteVaultId.value) return;

  creatingMapping.value = true;
  error.value = '';
  successMessage.value = '';
  try {
    await syncMapVault(selectedRemoteId.value, selectedLocalVaultId.value, selectedRemoteVaultId.value);
    successMessage.value = 'Mapping created successfully.';
    emit('changed');
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create mapping.';
  } finally {
    creatingMapping.value = false;
  }
}
</script>
