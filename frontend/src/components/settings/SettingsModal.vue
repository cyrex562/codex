<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    :fullscreen="isMobile"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        Settings
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="plain" data-testid="settings-modal-close-btn" @click="close" />
      </v-card-title>

      <v-tabs v-model="activeTab">
        <v-tab value="api-keys">API Keys</v-tab>
        <v-tab v-if="isTauri()" value="sync">Sync</v-tab>
      </v-tabs>

      <v-divider />

      <v-card-text :style="isMobile ? 'overflow-y: auto;' : 'max-height: 600px; overflow-y: auto;'">
        <v-tabs-window v-model="activeTab">
          <v-tabs-window-item value="api-keys">
            <ApiKeysPanel />
          </v-tabs-window-item>
          <v-tabs-window-item v-if="isTauri()" value="sync">
            <SyncSettingsPanel />
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ApiKeysPanel from '@/components/settings/ApiKeysPanel.vue';
import SyncSettingsPanel from '@/components/settings/sync/SyncSettingsPanel.vue';
import { isTauri } from '@/utils/tauri';
import { useMobile } from '@/composables/useMobile';

const { isMobile } = useMobile();

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const activeTab = ref('api-keys');

function close() {
  emit('update:modelValue', false);
}
</script>
