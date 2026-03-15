<template>
  <div class="tags-panel">
    <div
      class="tags-header d-flex align-center px-2 py-1"
      style="cursor: pointer; border-bottom: 1px solid rgb(var(--v-theme-border));"
      @click="expanded = !expanded"
    >
      <v-icon :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="x-small" />
      <span class="text-caption text-secondary ml-1 font-weight-medium">TAGS</span>
      <span v-if="tags.length" class="text-caption text-secondary ml-1">({{ tags.length }})</span>
      <v-progress-circular v-if="loading" size="10" width="1" indeterminate class="ml-auto" />
    </div>
    <div v-if="expanded">
      <div v-if="tags.length" class="tags-list">
        <div
          v-for="entry in sortedTags"
          :key="entry.tag"
          class="tag-item d-flex align-center px-2 py-1 text-caption"
          :title="`Search ${entry.tag} (${entry.count} note(s))`"
          @click="searchTag(entry.tag)"
        >
          <v-icon icon="mdi-tag-outline" size="x-small" class="mr-1 flex-shrink-0" color="secondary" />
          <span class="text-truncate flex-1">{{ entry.tag }}</span>
          <span class="text-secondary ml-1">{{ entry.count }}</span>
        </div>
      </div>
      <div v-else-if="!loading" class="pa-2 text-caption text-secondary text-center">
        No tags found in this vault.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useVaultsStore } from '@/stores/vaults';
import { apiListTags } from '@/api/client';
import type { TagEntry } from '@/api/types';

const emit = defineEmits<{ search: [query: string] }>();

const expanded = ref(true);
const loading = ref(false);
const tags = ref<TagEntry[]>([]);

const vaultsStore = useVaultsStore();

const sortedTags = computed(() =>
  [...tags.value].sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag)),
);

watch(
  () => vaultsStore.activeVaultId,
  async (vaultId) => {
    if (!vaultId) {
      tags.value = [];
      return;
    }
    loading.value = true;
    try {
      tags.value = await apiListTags(vaultId);
    } catch {
      tags.value = [];
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function searchTag(tag: string) {
  const normalized = tag.startsWith('#') ? tag : `#${tag}`;
  emit('search', normalized);
}
</script>

<style scoped>
.tags-header:hover {
  background: rgb(var(--v-theme-surface-variant));
}
.tag-item {
  cursor: pointer;
  color: rgb(var(--v-theme-on-surface));
  border-left: 2px solid transparent;
}
.tag-item:hover {
  background: rgb(var(--v-theme-surface-variant));
  border-left-color: rgb(var(--v-theme-primary));
}
</style>
