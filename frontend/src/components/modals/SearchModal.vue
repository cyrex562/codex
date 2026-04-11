<template>
  <v-dialog :model-value="modelValue" max-width="640" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        Search
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="plain" @click="close" />
      </v-card-title>

      <v-card-text>
        <v-text-field
          v-model="query"
          label="Search"
          placeholder="Try #tag, phrase, or filename"
          prepend-inner-icon="mdi-magnify"
          autofocus
          clearable
          @keydown.esc="close"
          @keyup.enter="search"
          @click:clear="results = []"
        />

        <v-progress-linear v-if="loading" indeterminate class="mb-2" />

        <v-list v-if="results.length" density="compact" style="max-height: 400px; overflow-y: auto;">
          <v-list-item
            v-for="r in results"
            :key="r.path"
            :title="r.path"
            :subtitle="firstMatch(r)"
            @click="openResult(r.path)"
          />
        </v-list>

        <p v-else-if="!loading && searched" class="text-caption text-secondary text-center mt-2">
          No results found.
        </p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useVaultsStore } from '@/stores/vaults';
import { useTabsStore } from '@/stores/tabs';
import { apiSearch } from '@/api/client';
import type { SearchResult } from '@/api/types';

const props = defineProps<{ modelValue: boolean; initialQuery?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const vaultsStore = useVaultsStore();
const tabsStore = useTabsStore();

const query = ref('');
const results = ref<SearchResult[]>([]);
const loading = ref(false);
const searched = ref(false);

function close() {
  emit('update:modelValue', false);
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.initialQuery) return;
    query.value = props.initialQuery;
    void search();
  },
);

watch(
  () => props.initialQuery,
  (value) => {
    if (!props.modelValue || !value) return;
    query.value = value;
    void search();
  },
);

async function search() {
  if (!query.value.trim() || !vaultsStore.activeVaultId) return;
  loading.value = true;
  searched.value = false;
  try {
    const page = await apiSearch(vaultsStore.activeVaultId, query.value);
    results.value = page.results;
  } finally {
    loading.value = false;
    searched.value = true;
  }
}

function firstMatch(r: SearchResult): string {
  if (!r.matches?.length) return '';
  const m = r.matches[0];
   return m.line_text?.trim() ?? '';
}

function openResult(path: string) {
  tabsStore.openTab(tabsStore.activePaneId, path, path.split('/').pop()!);
  close();
}
</script>
