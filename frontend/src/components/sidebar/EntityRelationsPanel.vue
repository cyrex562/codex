<template>
  <v-expansion-panel v-if="isEntityFile">
    <v-expansion-panel-title>
      <v-icon class="mr-2" size="small">mdi-graph-outline</v-icon>
      Relations
      <v-badge v-if="relations.length" :content="relations.length" color="primary" inline class="ml-2" />
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div v-if="loading" class="d-flex justify-center py-2">
        <v-progress-circular size="20" indeterminate />
      </div>

      <div v-else-if="error" class="text-caption text-error pa-1">{{ error }}</div>

      <div v-else-if="!relations.length" class="text-caption text-medium-emphasis pa-1">
        No relations found.
      </div>

      <v-list v-else density="compact" class="pa-0">
        <v-list-item
          v-for="rel in relations"
          :key="rel.id"
          :prepend-icon="rel.is_inverse ? 'mdi-arrow-left' : 'mdi-arrow-right'"
          :title="relTitle(rel)"
          :subtitle="rel.relation_type ?? ''"
          class="pl-1"
          @click="openRelated(rel)"
        >
          <template #title>
            <span class="text-body-2">{{ relTitle(rel) }}</span>
          </template>
        </v-list-item>
      </v-list>

      <div v-if="entityType" class="mt-2">
        <v-chip size="x-small" :color="typeColor || 'primary'" label>
          <v-icon start size="x-small">mdi-cube-outline</v-icon>
          {{ entityType }}
        </v-chip>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { apiGetEntityByPath } from '@/api/client';
import type { Entity, EntityRelation } from '@/api/types';
import { useVaultsStore } from '@/stores/vaults';
import { useTabsStore } from '@/stores/tabs';
import { useGraphStore } from '@/stores/graph';

const props = defineProps<{ filePath: string }>();

const vaultsStore = useVaultsStore();
const tabsStore = useTabsStore();
const graphStore = useGraphStore();

const entity = ref<Entity | null>(null);
const relations = ref<EntityRelation[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const isEntityFile = computed(() => !!entity.value || loading.value);

const entityType = computed(() => entity.value?.entity_type ?? null);

const typeColor = computed(() => {
    if (!entityType.value) return null;
    return graphStore.typeColorMap[entityType.value] ?? null;
});

watch(
    () => props.filePath,
    async (path) => {
        if (!path || !path.endsWith('.md')) {
            entity.value = null;
            relations.value = [];
            return;
        }
        const vaultId = vaultsStore.activeVaultId;
        if (!vaultId) return;
        loading.value = true;
        error.value = null;
        try {
            const result = await apiGetEntityByPath(vaultId, path);
            entity.value = result.entity;
            relations.value = result.relations ?? [];
        } catch (e: unknown) {
            // 404 means not an entity — silently clear
            entity.value = null;
            relations.value = [];
            if (e instanceof Error && !e.message.includes('404')) {
                error.value = e.message;
            }
        } finally {
            loading.value = false;
        }
    },
    { immediate: true },
);

function relTitle(rel: EntityRelation): string {
    const p = rel.target_path;
    return p.split('/').pop()?.replace(/\.md$/, '') ?? p;
}

function openRelated(rel: EntityRelation) {
    tabsStore.openTab(tabsStore.activePaneId, rel.target_path, relTitle(rel));
}
</script>
