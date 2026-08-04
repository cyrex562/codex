<template>
  <div>
    <div class="d-flex justify-space-between align-center mb-3">
      <h3 class="text-subtitle-1">Conflicts</h3>
      <v-btn size="small" variant="outlined" :loading="scanning" data-testid="conflicts-refresh-btn" @click="refresh">
        Refresh
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <p v-if="!syncStore.conflictFiles.length" class="text-medium-emphasis text-body-2">
      No conflicts. Sync uses keep-both resolution, so a conflict here means both your local
      and remote edits survived as separate files.
    </p>

    <v-card
      v-for="c in syncStore.conflictFiles"
      :key="keyOf(c)"
      variant="outlined"
      class="mb-2 pa-3"
      data-testid="conflict-row"
    >
      <div class="text-body-2 font-weight-medium">{{ c.name }}</div>
      <div class="text-caption text-medium-emphasis mb-2">{{ vaultName(c.vaultId) }} / {{ c.path }}</div>

      <div class="d-flex flex-wrap ga-2">
        <v-btn size="small" variant="tonal" data-testid="conflict-open-btn" @click="open(c)">Open</v-btn>
        <v-btn
          size="small"
          variant="tonal"
          :disabled="!c.originalPath"
          data-testid="conflict-compare-btn"
          @click="compare(c)"
        >
          Compare
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          color="success"
          :disabled="!c.originalPath"
          :loading="resolvingKey === keyOf(c)"
          data-testid="conflict-keep-btn"
          @click="resolveKeep(c)"
        >
          Keep this version
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          color="error"
          :loading="resolvingKey === keyOf(c)"
          data-testid="conflict-discard-btn"
          @click="resolveDiscard(c)"
        >
          Discard this version
        </v-btn>
      </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSyncStore } from '@/stores/sync';
import { useVaultsStore } from '@/stores/vaults';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { mobileFileDelete, mobileFileRename, tauriErrorMessage } from '@/utils/tauri';
import type { ConflictFile } from '@/stores/sync';

const emit = defineEmits<{ 'file-opened': [] }>();

const syncStore = useSyncStore();
const vaultsStore = useVaultsStore();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();

const scanning = ref(false);
const error = ref('');
const resolvingKey = ref<string | null>(null);

onMounted(() => {
  void refresh();
});

function keyOf(c: ConflictFile): string {
  return `${c.vaultId}:${c.path}`;
}

function vaultName(id: string): string {
  return vaultsStore.vaults.find((v) => v.id === id)?.name ?? id;
}

async function refresh() {
  scanning.value = true;
  error.value = '';
  try {
    await syncStore.scanConflicts();
  } catch (e: any) {
    error.value = tauriErrorMessage(e, 'Failed to scan for conflicts.');
  } finally {
    scanning.value = false;
  }
}

function switchToVault(vaultId: string) {
  if (vaultsStore.activeVaultId !== vaultId) {
    vaultsStore.setActiveVault(vaultId);
  }
}

function openTabFor(path: string) {
  tabsStore.openTab(tabsStore.activePaneId, path, path.split('/').pop()!);
}

function open(c: ConflictFile) {
  switchToVault(c.vaultId);
  openTabFor(c.path);
  emit('file-opened');
}

function compare(c: ConflictFile) {
  if (!c.originalPath) return;
  switchToVault(c.vaultId);
  openTabFor(c.originalPath);
  openTabFor(c.path);
  emit('file-opened');
}

async function resolveKeep(c: ConflictFile) {
  if (!c.originalPath) return;

  resolvingKey.value = keyOf(c);
  error.value = '';
  try {
    await mobileFileDelete(c.vaultId, c.originalPath).catch(() => {
      // The original may already be gone (e.g. resolved elsewhere); the
      // rename below is what actually matters.
    });
    await mobileFileRename(c.vaultId, c.path, c.originalPath);
    await afterResolve(c.vaultId);
  } catch (e: any) {
    error.value = tauriErrorMessage(e, 'Failed to resolve conflict.');
  } finally {
    resolvingKey.value = null;
  }
}

async function resolveDiscard(c: ConflictFile) {
  resolvingKey.value = keyOf(c);
  error.value = '';
  try {
    await mobileFileDelete(c.vaultId, c.path);
    await afterResolve(c.vaultId);
  } catch (e: any) {
    error.value = tauriErrorMessage(e, 'Failed to resolve conflict.');
  } finally {
    resolvingKey.value = null;
  }
}

async function afterResolve(vaultId: string) {
  await syncStore.scanConflicts();
  if (vaultsStore.activeVaultId === vaultId) {
    await filesStore.loadTree(vaultId);
  }
}
</script>
