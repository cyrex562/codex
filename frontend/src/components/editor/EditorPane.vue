<template>
  <div class="editor-pane" style="flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column;">
    <!-- Welcome/empty state -->
    <div v-if="!activeTab" class="d-flex flex-column align-center justify-center" style="flex: 1; color: rgb(var(--v-theme-secondary));">
      <v-icon icon="mdi-note-text-outline" size="64" style="opacity: 0.25;" />
      <p class="mt-4 text-caption">Open a file from the sidebar to start editing.</p>
    </div>

    <!-- File content router -->
    <template v-else>
      <!-- Frontmatter panel above editor -->
      <FrontmatterPanel
        v-if="isMd && activeTab.frontmatter && Object.keys(activeTab.frontmatter).length > 0"
        :frontmatter="activeTab.frontmatter"
        :tab-id="activeTab.id"
      />

      <!-- Markdown: mode-aware editor -->
      <div v-if="isMd" class="d-flex" style="flex: 1; min-height: 0; overflow: hidden;">
        <!-- Raw editor always visible in raw / side_by_side / formatted_raw -->
        <MarkdownEditor
          v-if="editorMode !== 'fully_rendered'"
          :tab-id="activeTab.id"
          :content="activeTab.content ?? ''"
          class="editor-column"
          :class="{ 'half-width': editorMode === 'side_by_side' }"
          @update="onEditorUpdate"
        />
        <!-- Right side: preview for side_by_side / fully_rendered -->
        <MarkdownPreview
          v-if="editorMode === 'side_by_side' || editorMode === 'fully_rendered'"
          :content="activeTab.content ?? ''"
          :vault-id="vaultsStore.activeVaultId ?? ''"
          :current-file="activeTab.filePath"
          class="editor-column"
          :class="{ 'half-width': editorMode === 'side_by_side' }"
        />
        <!-- Tiptap rich text for formatted_raw -->
        <TiptapEditor
          v-if="editorMode === 'formatted_raw'"
          :tab-id="activeTab.id"
          :content="activeTab.content ?? ''"
          class="editor-column full-width"
          @update="onEditorUpdate"
        />
      </div>

      <!-- Image viewer -->
      <ImageViewer v-else-if="isImage" :vault-id="vaultsStore.activeVaultId ?? ''" :path="activeTab.filePath ?? ''" />

      <!-- PDF viewer -->
      <PdfViewer v-else-if="isPdf" :vault-id="vaultsStore.activeVaultId ?? ''" :path="activeTab.filePath ?? ''" />

      <!-- Audio/Video viewer -->
      <AudioVideoViewer v-else-if="isAv" :vault-id="vaultsStore.activeVaultId ?? ''" :path="activeTab.filePath ?? ''" />

      <!-- Generic binary notice -->
      <div v-else class="d-flex align-center justify-center" style="flex: 1;">
        <span class="text-caption text-secondary">Binary file — cannot be edited here.</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, defineAsyncComponent } from 'vue';
import { useTabsStore } from '@/stores/tabs';
import { useVaultsStore } from '@/stores/vaults';
import { useEditorStore } from '@/stores/editor';
import { useFilesStore } from '@/stores/files';
import { ApiError } from '@/api/client';
import { useUiStore } from '@/stores/ui';

import FrontmatterPanel from './FrontmatterPanel.vue';
import MarkdownEditor from './MarkdownEditor.vue';
const MarkdownPreview = defineAsyncComponent(() => import('./MarkdownPreview.vue'));
const TiptapEditor = defineAsyncComponent(() => import('./TiptapEditor.vue'));
const ImageViewer = defineAsyncComponent(() => import('@/components/viewers/ImageViewer.vue'));
const PdfViewer = defineAsyncComponent(() => import('@/components/viewers/PdfViewer.vue'));
const AudioVideoViewer = defineAsyncComponent(() => import('@/components/viewers/AudioVideoViewer.vue'));

const props = defineProps<{ paneId: string }>();

const tabsStore = useTabsStore();
const vaultsStore = useVaultsStore();
const editorStore = useEditorStore();
const filesStore = useFilesStore();
const uiStore = useUiStore();

const activeTab = computed(() => {
  const pane = tabsStore.panes.find(p => p.id === props.paneId);
  if (!pane?.activeTabId) return null;
  return tabsStore.tabs.get(pane.activeTabId) ?? null;
});

const editorMode = computed(() => editorStore.mode);

const ext = computed(() => activeTab.value?.filePath?.split('.').pop()?.toLowerCase() ?? '');
const isMd = computed(() => ext.value === 'md');
const isImage = computed(() => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext.value));
const isPdf = computed(() => ext.value === 'pdf');
const isAv = computed(() => ['mp4', 'webm', 'ogv', 'mov', 'mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(ext.value));

watch(activeTab, async (tab) => {
  if (!tab || tab.content !== '' || !tab.filePath) return;
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId) return;
  const fc = await filesStore.readFile(vaultId, tab.filePath);
  tabsStore.updateTabContent(tab.id, fc.content);
  tabsStore.markTabClean(tab.id, fc.modified ?? '');
  if (fc.frontmatter && Object.keys(fc.frontmatter).length > 0) {
    tabsStore.updateTabFrontmatter(tab.id, fc.frontmatter);
    tabsStore.markTabClean(tab.id, fc.modified ?? '');
  }
}, { immediate: true });

function onEditorUpdate(newContent: string) {
  const tab = activeTab.value;
  if (!tab) return;
  tabsStore.updateTabContent(tab.id, newContent);
  // Schedule auto-save in 2s
  editorStore.scheduleAutoSave(tab.id, 2000, async () => {
    const vaultId = vaultsStore.activeVaultId;
    if (!vaultId || !tab.filePath) return;
    try {
      const saved = await filesStore.writeFile(vaultId, tab.filePath, {
        content: newContent,
        last_modified: tab.modified || undefined,
        frontmatter: tab.frontmatter,
      });
      tabsStore.markTabClean(tab.id, saved.modified);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const latest = await filesStore.readFile(vaultId, tab.filePath);
        uiStore.openConflictResolver({
          tabId: tab.id,
          filePath: tab.filePath,
          yourVersion: newContent,
          serverVersion: latest.content,
          serverModified: latest.modified,
        });
        return;
      }
      throw error;
    }
  });
}
</script>

<style scoped>
.editor-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.half-width {
  flex: 1;
  max-width: 50%;
}
.full-width {
  max-width: 100%;
}
</style>
