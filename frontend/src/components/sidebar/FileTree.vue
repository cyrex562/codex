<template>
  <div class="file-tree pa-1">
    <FileTreeNode
      v-for="node in sortedTree"
      :key="node.path"
      :node="node"
      :depth="0"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { Ref } from 'vue';
import { useFilesStore } from '@/stores/files';
import FileTreeNode from './FileTreeNode.vue';

const filesStore = useFilesStore();
const sort = inject<Ref<'asc' | 'desc'>>('fileTreeSort', ref('asc'));

const sortedTree = computed(() => {
  const nodes = [...filesStore.tree];
  return sortNodes(nodes, sort.value);
});

function sortNodes(nodes: typeof filesStore.tree, dir: 'asc' | 'desc') {
  return [...nodes].sort((a, b) => {
    // Directories first
    if (a.is_directory && !b.is_directory) return -1;
    if (!a.is_directory && b.is_directory) return 1;
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    return dir === 'asc' ? cmp : -cmp;
  });
}
</script>

<style scoped>
.file-tree {
  user-select: none;
}
</style>
