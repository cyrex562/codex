<template>
  <div>
    <!-- Row -->
    <div
      class="file-tree-node d-flex align-center"
      :class="{ active: isActive, hovering: hovering }"
      :style="{ paddingLeft: depth * 16 + 8 + 'px' }"
      @click="onClick"
      @contextmenu.prevent="onContextMenu"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    >
      <!-- Expand chevron for dirs -->
      <v-icon
        v-if="node.is_directory"
        :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        size="16"
        style="flex-shrink: 0; color: rgb(var(--v-theme-secondary));"
      />
      <v-icon
        v-else
        :icon="fileIcon"
        size="16"
        style="flex-shrink: 0; color: rgb(var(--v-theme-secondary));"
      />

      <!-- Name (editable on double-click) -->
      <span
        v-if="!editing"
        class="text-caption ml-1 node-name"
        @dblclick.stop="startEdit"
      >{{ node.name }}</span>
      <v-text-field
        v-else
        v-model="editName"
        autofocus
        density="compact"
        variant="plain"
        hide-details
        class="ml-1"
        style="font-size: 12px; flex: 1;"
        @keyup.enter="confirmRename"
        @keyup.esc="editing = false"
        @blur="editing = false"
        @click.stop
      />

      <v-spacer />

      <!-- Inline action buttons, visible on hover -->
      <template v-if="hovering && !editing">
        <v-btn
          v-if="!node.is_directory"
          icon="mdi-pencil-outline"
          size="x-small"
          density="compact"
          @click.stop="startEdit"
        />
        <v-btn
          icon="mdi-delete-outline"
          size="x-small"
          density="compact"
          @click.stop="onDelete"
        />
      </template>
    </div>

    <!-- Children for directories -->
    <template v-if="node.is_directory && expanded && node.children">
      <FileTreeNode
        v-for="child in sortedChildren"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
    </template>

    <!-- Context menu -->
    <v-menu v-model="contextMenu" :style="{ top: cmY + 'px', left: cmX + 'px' }" style="position: fixed;">
      <v-list density="compact" min-width="160">
        <v-list-item v-if="!node.is_directory" title="Open" prepend-icon="mdi-file-outline" @click="openFile" />
        <v-list-item v-if="!node.is_directory" title="Open in split" prepend-icon="mdi-flip-horizontal" @click="openSplit" />
        <v-list-item title="Rename" prepend-icon="mdi-pencil-outline" @click="startEdit" />
        <v-list-item title="Delete" prepend-icon="mdi-delete-outline" base-color="error" @click="onDelete" />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue';
import type { Ref } from 'vue';
import type { FileNode } from '@/api/types';
import { useVaultsStore } from '@/stores/vaults';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';

const props = defineProps<{ node: FileNode; depth: number }>();

const vaultsStore = useVaultsStore();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();

const expanded = ref(props.depth < 1); // auto-expand first level
const hovering = ref(false);
const editing = ref(false);
const editName = ref('');
const contextMenu = ref(false);
const cmX = ref(0);
const cmY = ref(0);

const sort = inject<Ref<'asc' | 'desc'>>('fileTreeSort', ref('asc'));

const sortedChildren = computed(() => {
  if (!props.node.children) return [];
  return [...props.node.children].sort((a, b) => {
    if (a.is_directory && !b.is_directory) return -1;
    if (!a.is_directory && b.is_directory) return 1;
    const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return sort.value === 'asc' ? cmp : -cmp;
  });
});

const isActive = computed(() => {
  const activeTab = tabsStore.activeTab;
  return activeTab?.filePath === props.node.path;
});

const fileIcon = computed(() => {
  const ext = props.node.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'mdi-language-markdown-outline';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'mdi-image-outline';
  if (ext === 'pdf') return 'mdi-file-pdf-box';
  if (['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return 'mdi-video-outline';
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(ext)) return 'mdi-music-note-outline';
  if (ext === 'canvas') return 'mdi-vector-square';
  return 'mdi-file-outline';
});

function onClick() {
  if (props.node.is_directory) {
    expanded.value = !expanded.value;
  } else {
    openFile();
  }
}

function openFile() {
  tabsStore.openTab(tabsStore.activePaneId, props.node.path, props.node.name);
}

function openSplit() {
   const newPaneId = tabsStore.splitPane(tabsStore.activePaneId);
   if (newPaneId) {
     tabsStore.openTab(newPaneId, props.node.path, props.node.name);
   }
}

function onContextMenu(e: MouseEvent) {
  cmX.value = e.clientX;
  cmY.value = e.clientY;
  contextMenu.value = true;
}

function startEdit() {
  editName.value = props.node.name;
  editing.value = true;
}

async function confirmRename() {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId || !editName.value.trim() || editName.value === props.node.name) {
    editing.value = false;
    return;
  }
  editing.value = false;
  const dir = props.node.path.includes('/')
    ? props.node.path.substring(0, props.node.path.lastIndexOf('/') + 1)
    : '';
  await filesStore.renameFile(vaultId, props.node.path, dir + editName.value.trim());
}

async function onDelete() {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  if (!confirm(`Delete "${props.node.name}"?`)) return;
  await filesStore.deleteFile(vaultId, props.node.path);
}
</script>

<style scoped>
.file-tree-node {
  border-radius: 4px;
  cursor: pointer;
  min-height: 28px;
}
.file-tree-node.hovering {
  background: rgba(var(--v-theme-surface-bright), 0.6);
}
.file-tree-node.active {
  background: rgba(var(--v-theme-primary), 0.18);
}
.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: rgb(var(--v-theme-on-background));
}
</style>
