<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-text class="pa-2">
        <v-text-field
          v-model="query"
          placeholder="Search files…"
          prepend-inner-icon="mdi-magnify"
          autofocus
          hide-details
          clearable
          @input="onInput"
          @keydown.up.prevent="moveCursor(-1)"
          @keydown.down.prevent="moveCursor(1)"
          @keydown.enter="openSelected"
          @keydown.esc="close"
        />

        <v-list density="compact" style="max-height: 400px; overflow-y: auto; margin-top: 4px;">
          <v-list-item
            v-for="(item, idx) in filtered"
            :key="item.path"
            :title="item.name"
            :subtitle="item.path"
            :active="idx === cursor"
            active-color="primary"
            @click="openItem(item)"
          />
        </v-list>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import type { FileNode } from '@/api/types';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const filesStore = useFilesStore();
const tabsStore = useTabsStore();

const query = ref('');
const cursor = ref(0);

// Flatten the tree for quick lookup
function flattenTree(nodes: FileNode[], acc: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (!n.is_directory) acc.push(n);
    if (n.children) flattenTree(n.children, acc);
  }
  return acc;
}

const allFiles = computed(() => flattenTree(filesStore.tree));

const filtered = computed(() => {
  const q = query.value.toLowerCase();
  if (!q) return allFiles.value.slice(0, 50);
  return allFiles.value.filter(f =>
    f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  ).slice(0, 50);
});

watch(() => props.modelValue, (v) => {
  if (v) { query.value = ''; cursor.value = 0; }
});

function onInput() {
  cursor.value = 0;
}

function moveCursor(delta: number) {
  cursor.value = Math.max(0, Math.min(filtered.value.length - 1, cursor.value + delta));
}

function openSelected() {
  const item = filtered.value[cursor.value];
  if (item) openItem(item);
}

function openItem(item: FileNode) {
  tabsStore.openTab(tabsStore.activePaneId, item.path, item.name);
  close();
}

function close() {
  emit('update:modelValue', false);
}
</script>
