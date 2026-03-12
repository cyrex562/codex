<template>
  <div class="viewer d-flex align-center justify-center" style="flex: 1; overflow: hidden; background: rgb(var(--v-theme-background));">
    <img
      v-if="src"
      :src="src"
      alt="Image"
      style="max-width: 100%; max-height: 100%; object-fit: contain;"
    />
    <v-progress-circular v-else indeterminate />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ vaultId: string; path: string }>();

// Serve via the API download endpoint
const src = computed(() =>
  props.vaultId && props.path
    ? `/api/vaults/${props.vaultId}/files/${encodeURIComponent(props.path)}/download`
    : null
);
</script>
