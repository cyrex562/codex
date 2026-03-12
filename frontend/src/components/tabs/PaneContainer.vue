<template>
  <div
    class="pane-container"
    :class="tabsStore.splitOrientation === 'vertical' ? 'flex-column' : 'flex-row'"
  >
    <template v-for="(pane, idx) in tabsStore.panes" :key="pane.id">
      <div
        class="pane-wrapper"
        :style="{ flex: pane.flex }"
        @click.capture="tabsStore.setActivePaneId(pane.id)"
      >
        <TabBar :pane-id="pane.id" />
        <EditorPane :pane-id="pane.id" />
      </div>

      <!-- Resizer between panes -->
      <div
        v-if="idx < tabsStore.panes.length - 1"
        class="pane-resizer"
        :class="tabsStore.splitOrientation === 'vertical' ? 'resizer-h' : 'resizer-v'"
        @mousedown="startPaneResize($event, idx)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useTabsStore } from '@/stores/tabs';
import TabBar from './TabBar.vue';
import EditorPane from '@/components/editor/EditorPane.vue';

const tabsStore = useTabsStore();

// ── Pane resize ───────────────────────────────────────────────────────────────
let resizing = false;
let resizeStartCoord = 0;
let resizePaneIdx = 0;
let resizeStartFlexAleft = 0;
let resizeStartFlexBright = 0;
const TOTAL = 100; // pane flex sum target

function startPaneResize(e: MouseEvent, idx: number) {
  resizing = true;
  resizePaneIdx = idx;
  resizeStartCoord = tabsStore.splitOrientation === 'vertical' ? e.clientY : e.clientX;
  resizeStartFlexAleft = tabsStore.panes[idx].flex;
  resizeStartFlexBright = tabsStore.panes[idx + 1].flex;
  window.addEventListener('mousemove', onPaneResize);
  window.addEventListener('mouseup', stopPaneResize);
}

function onPaneResize(e: MouseEvent) {
  if (!resizing) return;
  const containerEl = document.querySelector('.pane-container') as HTMLElement;
  if (!containerEl) return;
  const totalSize = tabsStore.splitOrientation === 'vertical'
    ? containerEl.clientHeight
    : containerEl.clientWidth;
  const coord = tabsStore.splitOrientation === 'vertical' ? e.clientY : e.clientX;
  const delta = coord - resizeStartCoord;
  const deltaPercent = (delta / totalSize) * TOTAL;
  const newA = Math.max(10, resizeStartFlexAleft + deltaPercent);
  const newB = Math.max(10, resizeStartFlexBright - deltaPercent);
  if (newA + newB > TOTAL - 1) {
    tabsStore.panes[resizePaneIdx].flex = newA;
    tabsStore.panes[resizePaneIdx + 1].flex = newB;
  }
}

function stopPaneResize() {
  resizing = false;
  window.removeEventListener('mousemove', onPaneResize);
  window.removeEventListener('mouseup', stopPaneResize);
}
</script>

<style scoped>
.pane-container {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.pane-wrapper {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.pane-resizer {
  flex-shrink: 0;
  background: rgb(var(--v-theme-border));
  transition: background 0.15s;
  z-index: 10;
}
.pane-resizer:hover {
  background: rgb(var(--v-theme-primary));
}
.resizer-v {
  width: 4px;
  cursor: col-resize;
}
.resizer-h {
  height: 4px;
  cursor: row-resize;
}
</style>
