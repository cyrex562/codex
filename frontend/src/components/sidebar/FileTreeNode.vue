<template>
  <div>
    <!-- Row -->
    <div
      class="file-tree-node d-flex align-center"
      :class="{ active: isActive, hovering: hovering, 'import-drop-target': importDragOver, 'move-drop-target': moveDragOver }"
      :style="{ paddingLeft: depth * 16 + 8 + 'px' }"
      draggable="true"
      @click="onClick"
      @contextmenu.prevent="onContextMenu"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Expand chevron for dirs -->
      <v-icon
        v-if="node.is_directory"
        :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        size="16"
        style="flex-shrink: 0; color: rgb(var(--v-theme-secondary));"
        @click.stop="toggleExpanded"
      />
      <v-icon
        v-if="node.is_directory && isMdiIcon"
        :icon="resolvedIcon"
        size="16"
        style="flex-shrink: 0; color: rgb(var(--v-theme-secondary));"
      />
      <span v-else-if="node.is_directory" class="custom-icon text-caption ml-1">{{ resolvedIcon }}</span>
      <v-icon
        v-else-if="isMdiIcon"
        :icon="resolvedIcon"
        size="16"
        style="flex-shrink: 0; color: rgb(var(--v-theme-secondary));"
      />
      <span v-else class="custom-icon text-caption ml-1">{{ resolvedIcon }}</span>

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
      <v-list density="compact" min-width="180">
        <v-list-item v-if="node.is_directory" title="Open folder note" prepend-icon="mdi-notebook-outline" data-testid="ctx-open-folder-note" @click="openFolderNote" />
        <v-list-item v-if="node.is_directory" title="Create folder note" prepend-icon="mdi-note-plus-outline" data-testid="ctx-create-folder-note" @click="createFolderNote" />
        <v-divider v-if="node.is_directory" />
        <v-list-item v-if="node.is_directory" title="New file" prepend-icon="mdi-file-plus-outline" data-testid="ctx-new-file" @click="newFileInFolder" />
        <v-list-item v-if="node.is_directory" title="New folder" prepend-icon="mdi-folder-plus-outline" data-testid="ctx-new-folder" @click="newFolderInFolder" />
        <v-divider v-if="node.is_directory" />
        <v-list-item v-if="!node.is_directory" title="Open" prepend-icon="mdi-file-outline" data-testid="ctx-open-file" @click="openFile" />
        <v-list-item v-if="!node.is_directory" title="Open in split" prepend-icon="mdi-flip-horizontal" data-testid="ctx-open-split" @click="openSplit" />
        <v-list-item title="Set custom icon" prepend-icon="mdi-emoticon-outline" data-testid="ctx-set-icon" @click="setCustomIcon" />
        <v-list-item title="Clear custom icon" prepend-icon="mdi-emoticon-remove-outline" data-testid="ctx-clear-icon" @click="clearCustomIcon" />
        <v-list-item title="Rename" prepend-icon="mdi-pencil-outline" data-testid="ctx-rename" @click="startEdit" />
        <v-divider />
        <v-list-item title="Export as ZIP" prepend-icon="mdi-folder-zip-outline" data-testid="ctx-export-zip" @click="exportAsZip" />
        <v-list-item title="Export as tar.gz" prepend-icon="mdi-archive-arrow-down-outline" data-testid="ctx-export-tar" @click="exportAsTar" />
        <v-divider />
        <v-list-item title="Delete" prepend-icon="mdi-delete-outline" base-color="error" data-testid="ctx-delete" @click="onDelete" />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue';
import type { Ref } from 'vue';
import type { FileNode } from '@/api/types';
import { ApiError } from '@/api/client';
import { useVaultsStore } from '@/stores/vaults';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { useUiStore } from '@/stores/ui';
import { usePreferencesStore } from '@/stores/preferences';
import { createImportCandidatesFromDataTransfer, hasFilePayload, parentDirectory } from '@/utils/importEntries';
import { getFileTreeDragPayload, setFileTreeDragPayload } from '@/utils/fileTreeDrag';

const props = defineProps<{ node: FileNode; depth: number }>();

const vaultsStore = useVaultsStore();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();
const uiStore = useUiStore();
const prefsStore = usePreferencesStore();

const expanded = ref(props.depth < 1); // auto-expand first level
const hovering = ref(false);
const editing = ref(false);
const editName = ref('');
const contextMenu = ref(false);
const cmX = ref(0);
const cmY = ref(0);
const importDragOver = ref(false);
const moveDragOver = ref(false);

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
  if (props.node.is_directory) return 'mdi-folder-outline';
  const ext = props.node.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'mdi-language-markdown-outline';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'mdi-image-outline';
  if (ext === 'pdf') return 'mdi-file-pdf-box';
  if (['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return 'mdi-video-outline';
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(ext)) return 'mdi-music-note-outline';
  if (ext === 'canvas') return 'mdi-vector-square';
  return 'mdi-file-outline';
});

const resolvedIcon = computed(() => prefsStore.getIcon(props.node.path) ?? fileIcon.value);
const isMdiIcon = computed(() => resolvedIcon.value.startsWith('mdi-'));

async function onClick() {
  if (props.node.is_directory) {
    await openFolderNote();
  } else {
    openFile();
  }
}

function toggleExpanded() {
  expanded.value = !expanded.value;
}

function openFile() {
  tabsStore.openTab(tabsStore.activePaneId, props.node.path, props.node.name);
}

function folderNoteCandidates(): string[] {
  return [`${props.node.name}.md`, 'index.md'];
}

function findExistingFolderNotePath(): string | null {
  if (!props.node.children) return null;
  const candidates = folderNoteCandidates().map((c) => c.toLowerCase());
  const match = props.node.children.find((child) =>
    !child.is_directory && candidates.includes(child.name.toLowerCase()),
  );
  return match?.path ?? null;
}

function defaultFolderNotePath(): string {
  return `${props.node.path}/${props.node.name}.md`;
}

async function openFolderNote() {
  if (!props.node.is_directory) return;
  const existing = findExistingFolderNotePath();
  if (existing) {
    const fileName = existing.split('/').pop() ?? existing;
    tabsStore.openTab(tabsStore.activePaneId, existing, fileName);
    return;
  }

  expanded.value = !expanded.value;
  const shouldCreate = confirm(`No folder note found for "${props.node.name}". Create one now?`);
  if (!shouldCreate) return;
  await createFolderNote();
}

async function createFolderNote() {
  if (!props.node.is_directory) return;
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;

  const existing = findExistingFolderNotePath();
  const path = existing ?? defaultFolderNotePath();
  const fileName = path.split('/').pop() ?? path;

  if (!existing) {
    const initial = `# ${props.node.name}\n`;
    await filesStore.createFile(vaultId, path, initial);
  }

  tabsStore.openTab(tabsStore.activePaneId, path, fileName);
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
  const oldPath = props.node.path;
  const newPath = await filesStore.renameFile(vaultId, oldPath, dir + editName.value.trim());
  tabsStore.remapTabPaths(oldPath, newPath);
  prefsStore.remapPathIcon(oldPath, newPath);
  await prefsStore.save();
}

async function onDelete() {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  if (!confirm(`Delete "${props.node.name}"?`)) return;
  prefsStore.clearIconsUnderPath(props.node.path);
  await prefsStore.save();
  // Close any tabs for this file/folder before deleting
  tabsStore.closeTabsByPath(props.node.path);
  await filesStore.deleteFile(vaultId, props.node.path);
}

async function setCustomIcon() {
  const current = prefsStore.getIcon(props.node.path) ?? '';
  const val = prompt('Enter a custom icon (emoji or mdi-* name):', current);
  if (val == null) return;
  const trimmed = val.trim();
  if (!trimmed) return;
  prefsStore.setIcon(props.node.path, trimmed);
  await prefsStore.save();
}

async function clearCustomIcon() {
  prefsStore.clearIcon(props.node.path);
  await prefsStore.save();
}

async function newFileInFolder() {
  if (!props.node.is_directory) return;
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  
  const fileName = prompt('Enter file name:', 'untitled.md');
  if (!fileName || !fileName.trim()) return;
  
  const name = fileName.trim().endsWith('.md') ? fileName.trim() : fileName.trim() + '.md';
  const filePath = `${props.node.path}/${name}`;
  
  const node = await filesStore.createFile(vaultId, filePath);
  if (node) {
    expanded.value = true;
    tabsStore.openTab(tabsStore.activePaneId, node.path, node.path.split('/').pop()!);
  }
}

async function newFolderInFolder() {
  if (!props.node.is_directory) return;
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  
  const folderName = prompt('Enter folder name:', 'New Folder');
  if (!folderName || !folderName.trim()) return;
  
  const folderPath = `${props.node.path}/${folderName.trim()}`;
  await filesStore.createDirectory(vaultId, folderPath);
  expanded.value = true;
}

function importTargetPath() {
  return props.node.is_directory ? props.node.path : parentDirectory(props.node.path);
}

function basename(path: string) {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function moveTargetPath() {
  return props.node.is_directory ? props.node.path : parentDirectory(props.node.path);
}

function isInvalidMoveSource(sourcePath: string) {
  if (sourcePath === props.node.path) return true;
  const destinationDirectory = moveTargetPath();
  return destinationDirectory === sourcePath || destinationDirectory.startsWith(`${sourcePath}/`);
}

function clearDropState() {
  importDragOver.value = false;
  moveDragOver.value = false;
}

function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return;
  setFileTreeDragPayload(e.dataTransfer, {
    path: props.node.path,
    name: props.node.name,
    isDirectory: props.node.is_directory,
  });
}

function onDragEnd() {
  clearDropState();
}

function onDragEnter(e: DragEvent) {
  e.stopPropagation();
  const internalPayload = getFileTreeDragPayload(e.dataTransfer);
  if (internalPayload) {
    moveDragOver.value = !isInvalidMoveSource(internalPayload.path);
    importDragOver.value = false;
    return;
  }

  if (!hasFilePayload(e.dataTransfer)) return;
  importDragOver.value = true;
}

function onDragOver(e: DragEvent) {
  e.stopPropagation();
  const internalPayload = getFileTreeDragPayload(e.dataTransfer);
  if (internalPayload) {
    const invalid = isInvalidMoveSource(internalPayload.path);
    moveDragOver.value = !invalid;
    importDragOver.value = false;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = invalid ? 'none' : 'move';
    }
    return;
  }

  if (!hasFilePayload(e.dataTransfer)) return;
  importDragOver.value = true;
}

function onDragLeave(e: DragEvent) {
  const nextTarget = e.relatedTarget as Node | null;
  if (nextTarget && (e.currentTarget as HTMLElement | null)?.contains(nextTarget)) {
    return;
  }
  clearDropState();
}

async function moveDraggedNode(sourcePath: string) {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;

  if (isInvalidMoveSource(sourcePath)) {
    alert('You cannot move a folder into itself or one of its descendants.');
    return;
  }

  const destinationDirectory = moveTargetPath();
  const nextPath = destinationDirectory ? `${destinationDirectory}/${basename(sourcePath)}` : basename(sourcePath);
  if (nextPath === sourcePath) {
    return;
  }

  try {
    const renamedPath = await filesStore.renameFile(vaultId, sourcePath, nextPath);
    tabsStore.remapTabPaths(sourcePath, renamedPath);
    prefsStore.remapPathIcon(sourcePath, renamedPath);
    await prefsStore.save();
    if (props.node.is_directory) {
      expanded.value = true;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      alert(`A file or folder named "${basename(sourcePath)}" already exists in the target location.`);
      return;
    }
    throw error;
  }
}

async function onDrop(e: DragEvent) {
  e.stopPropagation();
  const internalPayload = getFileTreeDragPayload(e.dataTransfer);
  if (internalPayload) {
    clearDropState();
    await moveDraggedNode(internalPayload.path);
    return;
  }

  importDragOver.value = false;
  if (!e.dataTransfer || !hasFilePayload(e.dataTransfer)) return;

  const candidates = await createImportCandidatesFromDataTransfer(e.dataTransfer);
  if (candidates.length > 0) {
    uiStore.openImportDialog({
      targetPath: importTargetPath(),
      entries: candidates,
    });
  }
}

async function exportAsZip() {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  await filesStore.downloadAsZip(vaultId, [props.node.path]);
}

async function exportAsTar() {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  await filesStore.downloadAsTar(vaultId, [props.node.path]);
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
.file-tree-node.import-drop-target {
  background: rgba(var(--v-theme-primary), 0.12);
  outline: 1px dashed rgba(var(--v-theme-primary), 0.65);
}
.file-tree-node.move-drop-target {
  background: rgba(var(--v-theme-primary), 0.18);
  outline: 1px solid rgba(var(--v-theme-primary), 0.75);
}
.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: rgb(var(--v-theme-on-background));
}
.custom-icon {
  width: 16px;
  min-width: 16px;
  text-align: center;
  line-height: 1;
}
</style>
