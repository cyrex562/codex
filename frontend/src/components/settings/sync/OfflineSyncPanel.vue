<template>
  <div>
    <PairingSection />

    <template v-if="syncStore.isPaired">
      <v-divider class="my-6" />
      <SyncStatusPanel />

      <v-divider class="my-6" />
      <ConflictsPanel @file-opened="emit('close')" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useSyncStore } from '@/stores/sync';
import PairingSection from '@/components/sync/PairingSection.vue';
import SyncStatusPanel from '@/components/sync/SyncStatusPanel.vue';
import ConflictsPanel from '@/components/sync/ConflictsPanel.vue';

const emit = defineEmits<{ close: [] }>();

const syncStore = useSyncStore();
</script>
