<template>
  <v-chip
    size="x-small"
    :color="chipColor"
    variant="tonal"
    data-testid="topbar-sync-chip"
    @click="emit('click')"
  >
    <v-badge
      v-if="syncStore.conflictCount > 0"
      :content="syncStore.conflictCount"
      color="error"
      inline
      data-testid="topbar-sync-conflict-badge"
    >
      <v-icon :start="!isMobile" :icon="chipIcon" />
    </v-badge>
    <v-icon v-else :start="!isMobile" :icon="chipIcon" />
    <template v-if="!isMobile">{{ chipLabel }}</template>
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '@/stores/sync';
import { useMobile } from '@/composables/useMobile';
import { stateColor, stateLabel, stateIcon, worstState } from '@/utils/syncStateDisplay';

const emit = defineEmits<{ click: [] }>();

const syncStore = useSyncStore();
const { isMobile } = useMobile();

const hasError = computed(() => syncStore.statuses.some((s) => s.last_error));
const aggregateState = computed(() => worstState(syncStore.statuses.map((s) => s.state)));

const chipColor = computed(() => {
  if (hasError.value) return 'error';
  return aggregateState.value ? stateColor(aggregateState.value) : 'default';
});

const chipIcon = computed(() => {
  if (hasError.value) return 'mdi-alert-circle-outline';
  return aggregateState.value ? stateIcon(aggregateState.value) : 'mdi-cloud-off-outline';
});

const chipLabel = computed(() => {
  if (hasError.value) return 'Sync error';
  return aggregateState.value ? stateLabel(aggregateState.value) : 'Not paired';
});
</script>
