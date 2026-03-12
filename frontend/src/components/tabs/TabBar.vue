<template>
  <div
    class="tab-bar d-flex align-center"
    style="overflow-x: auto; flex-shrink: 0; border-bottom: 1px solid rgb(var(--v-theme-border));"
  >
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="tab-item d-flex align-center"
      :class="{ 'tab-active': tab.id === activeTabId }"
      @click="tabsStore.activateTab(tab.id)"
      @mousedown.middle.prevent="requestCloseTab(tab.id)"
    >
      <v-icon :icon="tabIcon(tab)" size="14" class="mr-1" />
      <span class="tab-title text-caption">{{ tab.fileName }}</span>
      <span v-if="tab.isDirty" class="tab-dirty ml-1">●</span>
      <v-btn
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTabsStore } from '@/stores/tabs';
import type { Tab } from '@/api/types';

const props = defineProps<{ paneId: string }>();
const tabsStore = useTabsStore();

const tabs = computed(() => tabsStore.tabsForPane(props.paneId));
const activeTabId = computed(() => {
  const pane = tabsStore.panes.find(p => p.id === props.paneId);
  return pane?.activeTabId;
});

function requestCloseTab(tabId: string) {
  const tab = tabsStore.tabs.get(tabId);
  if (!tab) return;
  if (tab.isDirty && !confirm(`Close \"${tab.fileName}\" without saving?`)) {
    return;
  }
  tabsStore.closeTab(tabId);
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
</style>
