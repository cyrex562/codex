<template>
  <v-dialog :model-value="modelValue" max-width="1200" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        Resolve Conflict
        <v-spacer />
        <v-chip size="small" color="warning" variant="tonal">{{ conflict?.filePath }}</v-chip>
      </v-card-title>

      <v-card-text>
        <v-alert type="warning" variant="tonal" class="mb-4">
          The file changed on disk before auto-save completed. Choose which version wins — diplomacy for markdown.
        </v-alert>

        <div class="d-flex ga-4 conflict-columns">
          <div class="conflict-column">
            <div class="text-subtitle-2 mb-2">Your version</div>
            <v-textarea
              :model-value="conflict?.yourVersion ?? ''"
              readonly
              auto-grow
              rows="18"
              variant="outlined"
              class="conflict-textarea"
            />
          </div>
          <div class="conflict-column">
            <div class="text-subtitle-2 mb-2">Server version</div>
            <v-textarea
              :model-value="conflict?.serverVersion ?? ''"
              readonly
              auto-grow
              rows="18"
              variant="outlined"
              class="conflict-textarea"
            />
          </div>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-spacer />
        <v-btn color="secondary" variant="tonal" :loading="loading" @click="useServer">Use Server Version</v-btn>
        <v-btn color="primary" :loading="loading" @click="keepMine">Keep My Version</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useVaultsStore } from '@/stores/vaults';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const uiStore = useUiStore();
const vaultsStore = useVaultsStore();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();
const loading = ref(false);

const conflict = computed(() => uiStore.conflictState);

function close() {
    uiStore.closeConflictResolver();
    emit('update:modelValue', false);
}

function cancel() {
    close();
}

async function useServer() {
    const vaultId = vaultsStore.activeVaultId;
    const state = conflict.value;
    if (!vaultId || !state) return;

    loading.value = true;
    try {
        const latest = await filesStore.readFile(vaultId, state.filePath);
        tabsStore.updateTabContent(state.tabId, latest.content);
        tabsStore.markTabClean(state.tabId, latest.modified);
        if (latest.frontmatter) {
            tabsStore.updateTabFrontmatter(state.tabId, latest.frontmatter);
            tabsStore.markTabClean(state.tabId, latest.modified);
        }
        close();
    } finally {
        loading.value = false;
    }
}

async function keepMine() {
    const vaultId = vaultsStore.activeVaultId;
    const state = conflict.value;
    if (!vaultId || !state) return;

    loading.value = true;
    try {
        const saved = await filesStore.writeFile(vaultId, state.filePath, {
            content: state.yourVersion,
        });
        tabsStore.updateTabContent(state.tabId, saved.content);
        tabsStore.markTabClean(state.tabId, saved.modified);
        if (saved.frontmatter) {
            tabsStore.updateTabFrontmatter(state.tabId, saved.frontmatter);
            tabsStore.markTabClean(state.tabId, saved.modified);
        }
        close();
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.conflict-columns {
  align-items: stretch;
}
.conflict-column {
  flex: 1;
  min-width: 0;
}
@media (max-width: 900px) {
  .conflict-columns {
    flex-direction: column;
  }
}
</style>
