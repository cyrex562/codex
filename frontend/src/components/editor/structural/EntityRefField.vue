<template>
  <div class="entity-ref-field">
    <!-- Autocomplete backed by vault entity list -->
    <v-autocomplete
      :model-value="modelValue"
      :items="suggestions"
      item-title="display"
      item-value="wikilink"
      density="compact"
      variant="outlined"
      hide-details="auto"
      clearable
      :loading="loadingSuggestions"
      no-data-text="No matching entities"
      @update:model-value="emit('update:modelValue', $event)"
      @update:search="onSearch"
    >
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps" :subtitle="item.raw.path" />
      </template>
    </v-autocomplete>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiListEntities } from '@/api/client';
import type { Entity } from '@/api/types';

const props = defineProps<{
    modelValue: string | null | undefined;
    vaultId: string;
    targetLabel?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string | null];
}>();

interface Suggestion {
    display: string;
    wikilink: string;
    path: string;
}

const suggestions = ref<Suggestion[]>([]);
const loadingSuggestions = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function entityToSuggestion(e: Entity): Suggestion {
    const filename = e.path.split('/').pop()?.replace(/\.md$/, '') ?? e.path;
    return {
        display: (e.fields?.title as string) || filename,
        wikilink: `[[${filename}]]`,
        path: e.path,
    };
}

async function loadSuggestions(q?: string) {
    if (!props.vaultId) return;
    loadingSuggestions.value = true;
    try {
        const resp = await apiListEntities(props.vaultId, {
            label: props.targetLabel,
            q: q || undefined,
        });
        suggestions.value = resp.entities.map(entityToSuggestion);
    } catch {
        suggestions.value = [];
    } finally {
        loadingSuggestions.value = false;
    }
}

function onSearch(q: string) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadSuggestions(q), 300);
}

// Load initial suggestions when component mounts
watch(() => props.vaultId, () => { if (props.vaultId) loadSuggestions(); }, { immediate: true });
</script>
