<template>
  <div class="viewer d-flex flex-column align-center justify-center" style="flex: 1; overflow: hidden; background: rgb(var(--v-theme-background)); padding: 16px;">
    <video
      v-if="isVideo"
      :src="src ?? undefined"
      controls
      style="max-width: 100%; max-height: 100%;"
    />
    <audio
      v-else
      :src="src ?? undefined"
      controls
      style="width: 100%; max-width: 600px;"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ vaultId: string; path: string }>();

const src = computed(() =>
  props.vaultId && props.path
    ? `/api/vaults/${props.vaultId}/files/${encodeURIComponent(props.path)}/download`
    : null
);

const ext = computed(() => props.path.split('.').pop()?.toLowerCase() ?? '');
const isVideo = computed(() => ['mp4', 'webm', 'ogv', 'mov'].includes(ext.value));
</script>
