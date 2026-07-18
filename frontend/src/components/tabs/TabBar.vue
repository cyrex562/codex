<template>
  <div
    class="tab-bar d-flex align-center"
    style="overflow-x: auto; flex-shrink: 0; border-bottom: 1px solid rgb(var(--v-theme-border));"
  >
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="tab-item d-flex align-center"
      :class="{
        'tab-active': tab.id === activeTabId,
        'tab-drop-before': dropTargetId === tab.id && dropSide === 'left',
        'tab-drop-after': dropTargetId === tab.id && dropSide === 'right',
        'tab-dragging': draggingId === tab.id,
        'tab-pinned': tab.pinned,
      }"
      :title="tab.pinned ? tab.fileName : undefined"
      draggable="true"
      @click="tabsStore.activateTab(tab.id)"
      @contextmenu.prevent="openTabMenu($event, tab.id)"
      @mousedown.middle.prevent="requestCloseTab(tab.id)"
      @dragstart="onDragStart($event, tab.id)"
      @dragover="onDragOver($event, tab.id)"
      @dragleave="onDragLeave(tab.id)"
      @drop="onDrop($event, tab.id)"
      @dragend="onDragEnd"
    >
      <v-icon
        v-if="tab.pinned"
        icon="mdi-pin"
        size="12"
        class="mr-1 tab-pin-glyph"
        aria-label="Pinned"
      />
      <v-icon :icon="tabIcon(tab)" size="14" class="mr-1" />
      <span v-if="!tab.pinned" class="tab-title text-caption">{{ tab.fileName }}</span>
      <span v-if="tab.isDirty" class="tab-dirty ml-1">●</span>
      <v-btn
        v-if="!tab.pinned"
        icon="mdi-close"
        size="x-small"
        density="compact"
        variant="plain"
        class="ml-1 tab-close-btn"
        @click.stop="requestCloseTab(tab.id)"
      />
    </div>

    <!-- Spacer + split controls -->
    <div class="d-flex align-center ml-auto pl-2" style="flex-shrink: 0;">
      <v-btn
        v-if="tabsStore.panes.length < 4"
        icon="mdi-flip-horizontal"
        size="x-small"
        density="compact"
        variant="plain"
        title="Split pane"
        @click="tabsStore.splitPane(paneId)"
      />
      <v-btn
        v-if="tabsStore.panes.length > 1"
        icon="mdi-close"
        size="x-small"
        density="compact"
        variant="plain"
        title="Close pane"
        @click="tabsStore.closePane(paneId)"
      />
    </div>

    <v-menu v-model="tabMenuOpen" :style="{ top: tabMenuY + 'px', left: tabMenuX + 'px' }" style="position: fixed;">
      <v-list density="compact" min-width="180">
        <v-list-item
          :title="contextTabPinned ? 'Unpin tab' : 'Pin tab'"
          :prepend-icon="contextTabPinned ? 'mdi-pin-off' : 'mdi-pin'"
          @click="toggleContextTabPinned"
        />
        <v-divider />
        <v-list-item title="Close" prepend-icon="mdi-close" @click="closeContextTab" />
        <v-list-item
          title="Close to the right"
          prepend-icon="mdi-arrow-collapse-right"
          :disabled="contextTabIdsToRight.length === 0"
          @click="closeTabsToRight"
        />
        <v-list-item
          title="Close other tabs"
          prepend-icon="mdi-close-box-outline"
          :disabled="contextOtherTabIds.length === 0"
          @click="closeOtherTabs"
        />
        <v-list-item
          title="Close all in pane"
          prepend-icon="mdi-close-box-multiple-outline"
          :disabled="tabs.length === 0"
          @click="closeAllTabsInPane"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTabsStore } from '@/stores/tabs';
import type { Tab } from '@/api/types';

const props = defineProps<{ paneId: string }>();
const tabsStore = useTabsStore();

const tabs = computed(() => tabsStore.tabsForPane(props.paneId));
const activeTabId = computed(() => {
  const pane = tabsStore.panes.find(p => p.id === props.paneId);
  return pane?.activeTabId;
});
const tabMenuOpen = ref(false);
const tabMenuX = ref(0);
const tabMenuY = ref(0);
const contextTabId = ref<string | null>(null);

// Drag-to-reorder state. `draggingId` tracks which tab the user is dragging;
// `dropTargetId` + `dropSide` drive the CSS class that renders the drop-target
// indicator line. All three go back to null when the drag ends.
const draggingId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const dropSide = ref<'left' | 'right'>('left');
// Drag-payload MIME type — namespaced so the drop handler can distinguish an
// intra-app tab drag from arbitrary text dragged in from elsewhere.
const DRAG_MIME = 'application/x-librarium-tab-id';
const contextTabIdsToRight = computed(() => (
  contextTabId.value ? tabsStore.tabIdsToRight(props.paneId, contextTabId.value) : []
));
const contextOtherTabIds = computed(() => (
  contextTabId.value ? tabsStore.tabIdsExcept(props.paneId, contextTabId.value) : []
));
const contextTabPinned = computed(() => {
  if (!contextTabId.value) return false;
  return !!tabsStore.tabs.get(contextTabId.value)?.pinned;
});

function requestCloseTab(tabId: string) {
  const tab = tabsStore.tabs.get(tabId);
  if (!tab) return;
  if (tab.isDirty && !confirm(`Close \"${tab.fileName}\" without saving?`)) {
    return;
  }
  tabsStore.closeTab(tabId);
}

function requestCloseTabs(tabIds: string[]) {
  const closeable: string[] = [];
  for (const tabId of tabIds) {
    const tab = tabsStore.tabs.get(tabId);
    if (!tab) continue;
    if (tab.isDirty && !confirm(`Close \"${tab.fileName}\" without saving?`)) {
      continue;
    }
    closeable.push(tabId);
  }
  tabsStore.closeTabs(closeable);
}

function openTabMenu(event: MouseEvent, tabId: string) {
  tabMenuX.value = event.clientX;
  tabMenuY.value = event.clientY;
  contextTabId.value = tabId;
  tabMenuOpen.value = true;
}

function closeContextTab() {
  if (!contextTabId.value) return;
  requestCloseTab(contextTabId.value);
}

function toggleContextTabPinned() {
  if (!contextTabId.value) return;
  tabsStore.toggleTabPinned(contextTabId.value);
}

function closeTabsToRight() {
  requestCloseTabs(contextTabIdsToRight.value);
}

function closeOtherTabs() {
  requestCloseTabs(contextOtherTabIds.value);
}

function closeAllTabsInPane() {
  requestCloseTabs(tabsStore.tabIdsInPane(props.paneId));
}

function onDragStart(event: DragEvent, tabId: string) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(DRAG_MIME, tabId);
  draggingId.value = tabId;
}

function onDragOver(event: DragEvent, tabId: string) {
  // Only accept drops that carry the tab MIME — reject text drags from outside.
  if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  // Left half of the target → drop before; right half → drop after. This gives
  // the user pixel-precise control over the resulting position and matches
  // VS Code's tab drag behavior.
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const isLeft = event.clientX < rect.left + rect.width / 2;
  dropTargetId.value = tabId;
  dropSide.value = isLeft ? 'left' : 'right';
}

function onDragLeave(tabId: string) {
  // Clear only if we're leaving the currently-highlighted target; a leave on a
  // sibling could fire between two hover events without this guard.
  if (dropTargetId.value === tabId) {
    dropTargetId.value = null;
  }
}

function onDrop(event: DragEvent, targetId: string) {
  event.preventDefault();
  const sourceId = event.dataTransfer?.getData(DRAG_MIME);
  clearDragState();
  if (!sourceId || sourceId === targetId) return;
  const orderedIds = tabs.value.map((t) => t.id);
  const targetIdx = orderedIds.indexOf(targetId);
  if (targetIdx < 0) return;
  // Convert "drop before/after target" to a destination index. Splice-out /
  // splice-in in the store does the actual index normalization so we don't
  // have to reason about the source position here.
  const insertIdx = dropSide.value === 'left' ? targetIdx : targetIdx + 1;
  tabsStore.moveTabInPane(props.paneId, sourceId, insertIdx);
}

function onDragEnd() {
  clearDragState();
}

function clearDragState() {
  draggingId.value = null;
  dropTargetId.value = null;
}

function tabIcon(tab: Tab): string {
  const ext = tab.filePath?.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'mdi-language-markdown-outline';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'mdi-image-outline';
  if (ext === 'pdf') return 'mdi-file-pdf-box';
  if (['mp4', 'webm', 'ogv', 'mov'].includes(ext)) return 'mdi-video-outline';
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(ext)) return 'mdi-music-note-outline';
  return 'mdi-file-outline';
}
</script>

<style scoped>
.tab-bar {
  min-height: 36px;
  background: rgb(var(--v-theme-surface));
  gap: 2px;
  padding: 0 4px;
}
.tab-item {
  height: 32px;
  padding: 0 8px;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  max-width: 180px;
  transition: background 0.1s;
  color: rgb(var(--v-theme-on-background));
}
.tab-item:hover {
  background: rgba(var(--v-theme-surface-bright), 0.7);
}
.tab-item.tab-active {
  background: rgba(var(--v-theme-primary), 0.18);
}
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
.tab-dirty {
  color: rgb(var(--v-theme-primary));
  font-size: 10px;
  line-height: 1;
}
.tab-close-btn {
  opacity: 0;
  transition: opacity 0.1s;
}
.tab-item:hover .tab-close-btn,
.tab-item.tab-active .tab-close-btn {
  opacity: 1;
}

/* Drag-to-reorder visuals. The dragging tab dims itself; the drop target grows
   a coloured indicator line on the side the drop will land on. */
.tab-item {
  position: relative;
}
.tab-item.tab-dragging {
  opacity: 0.5;
}
.tab-item.tab-drop-before::before,
.tab-item.tab-drop-after::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
  pointer-events: none;
}
.tab-item.tab-drop-before::before {
  left: -1px;
}
.tab-item.tab-drop-after::after {
  right: -1px;
}

/* Pinned tabs render icon-only to save horizontal space; the file name lives
   in the `title` attribute so hovering still reveals it. */
.tab-item.tab-pinned {
  max-width: none;
  padding: 0 6px;
}
.tab-item.tab-pinned .tab-pin-glyph {
  color: rgb(var(--v-theme-primary));
}
</style>
