<template>
  <div
    class="file-tree pa-1"
    :class="{ 'file-tree-drop-target': draggingFiles }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropRoot"
  >
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
import { ApiError } from '@/api/client';
import { useFilesStore } from '@/stores/files';
import { useUiStore } from '@/stores/ui';
import { useTabsStore } from '@/stores/tabs';
import { useVaultsStore } from '@/stores/vaults';
import { usePreferencesStore } from '@/stores/preferences';
import { createImportCandidatesFromDataTransfer, hasFilePayload } from '@/utils/importEntries';
import { getFileTreeDragPayload, hasFileTreeDragPayload } from '@/utils/fileTreeDrag';
import FileTreeNode from './FileTreeNode.vue';

const filesStore = useFilesStore();
const uiStore = useUiStore();
const tabsStore = useTabsStore();
const vaultsStore = useVaultsStore();
const prefsStore = usePreferencesStore();
const sort = inject<Ref<'asc' | 'desc'>>('fileTreeSort', ref('asc'));
const draggingFiles = ref(false);

function basename(path: string) {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

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

function onDragEnter(e: DragEvent) {
  if (!hasFilePayload(e.dataTransfer) && !hasFileTreeDragPayload(e.dataTransfer)) return;
  draggingFiles.value = true;
}

function onDragOver(e: DragEvent) {
  if (!hasFilePayload(e.dataTransfer) && !hasFileTreeDragPayload(e.dataTransfer)) return;
  draggingFiles.value = true;

  if (hasFileTreeDragPayload(e.dataTransfer) && e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function onDragLeave(e: DragEvent) {
  const nextTarget = e.relatedTarget as Node | null;
  if (nextTarget && (e.currentTarget as HTMLElement | null)?.contains(nextTarget)) {
    return;
  }
  draggingFiles.value = false;
}

async function onDropRoot(e: DragEvent) {
  draggingFiles.value = false;
  const internalPayload = getFileTreeDragPayload(e.dataTransfer);
  if (internalPayload) {
    const vaultId = vaultsStore.activeVaultId;
    if (!vaultId) return;

    const nextPath = basename(internalPayload.path);
    if (nextPath === internalPayload.path) return;

    try {
      const renamedPath = await filesStore.renameFile(vaultId, internalPayload.path, nextPath);
      tabsStore.remapTabPaths(internalPayload.path, renamedPath);
      prefsStore.remapPathIcon(internalPayload.path, renamedPath);
      await prefsStore.save();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        alert(`A file or folder named "${basename(internalPayload.path)}" already exists at the vault root.`);
        return;
      }
      throw error;
    }
    return;
  }

  if (!e.dataTransfer || !hasFilePayload(e.dataTransfer)) return;
  const candidates = await createImportCandidatesFromDataTransfer(e.dataTransfer);
  if (candidates.length > 0) {
    uiStore.openImportDialog({ targetPath: '', entries: candidates });
  }
}
</script>

<style scoped>
.file-tree {
  user-select: none;
}

.file-tree-drop-target {
  background: rgba(var(--v-theme-primary), 0.08);
  outline: 1px dashed rgba(var(--v-theme-primary), 0.55);
  outline-offset: -2px;
  border-radius: 8px;
}
</style>
