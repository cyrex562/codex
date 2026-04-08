import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiGetGraph, apiListEntityTypes } from '@/api/client';
import type { GraphNode, GraphEdge, EntityTypeSchema } from '@/api/types';

export const useGraphStore = defineStore('graph', () => {
    const nodes = ref<GraphNode[]>([]);
    const edges = ref<GraphEdge[]>([]);
    const entityTypes = ref<EntityTypeSchema[]>([]);
    const loadedVaultId = ref<string | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // Active filters
    const visibleTypeIds = ref<Set<string>>(new Set());
    const searchQuery = ref('');

    const typeColorMap = computed(() => {
        const map: Record<string, string> = {};
        for (const t of entityTypes.value) {
            if (t.color) map[t.id] = t.color;
        }
        return map;
    });

    const filteredNodes = computed(() => {
        let result = nodes.value;
        if (visibleTypeIds.value.size > 0) {
            result = result.filter(
                (n) => n.entity_type && visibleTypeIds.value.has(n.entity_type),
            );
        }
        if (searchQuery.value.trim()) {
            const q = searchQuery.value.toLowerCase();
            result = result.filter(
                (n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q),
            );
        }
        return result;
    });

    const filteredNodeIds = computed(() => new Set(filteredNodes.value.map((n) => n.id)));

    const filteredEdges = computed(() =>
        edges.value.filter(
            (e) => filteredNodeIds.value.has(e.source) && filteredNodeIds.value.has(e.target),
        ),
    );

    const availableTypes = computed(() => {
        const seen = new Set<string>();
        for (const n of nodes.value) {
            if (n.entity_type) seen.add(n.entity_type);
        }
        return entityTypes.value.filter((t) => seen.has(t.id));
    });

    async function loadGraph(vaultId: string, force = false) {
        if (!force && loadedVaultId.value === vaultId && nodes.value.length > 0) return;
        loading.value = true;
        error.value = null;
        try {
            const [graphData, typesData] = await Promise.all([
                apiGetGraph(vaultId),
                apiListEntityTypes(),
            ]);

            entityTypes.value = typesData.entity_types ?? [];

            // Enrich nodes with color from entity type schema
            const colorMap: Record<string, string> = {};
            for (const t of entityTypes.value) {
                if (t.color) colorMap[t.id] = t.color;
            }

            nodes.value = (graphData.nodes ?? []).map((n) => ({
                ...n,
                color: n.entity_type ? colorMap[n.entity_type] : undefined,
            }));
            edges.value = graphData.edges ?? [];
            loadedVaultId.value = vaultId;
            // Default: show all types
            visibleTypeIds.value = new Set(entityTypes.value.map((t) => t.id));
        } catch (e: unknown) {
            error.value = e instanceof Error ? e.message : String(e);
        } finally {
            loading.value = false;
        }
    }

    function setTypeFilter(typeIds: string[]) {
        visibleTypeIds.value = new Set(typeIds);
    }

    function toggleType(typeId: string) {
        if (visibleTypeIds.value.has(typeId)) {
            visibleTypeIds.value.delete(typeId);
        } else {
            visibleTypeIds.value.add(typeId);
        }
    }

    function invalidate() {
        loadedVaultId.value = null;
    }

    return {
        nodes,
        edges,
        entityTypes,
        loadedVaultId,
        loading,
        error,
        visibleTypeIds,
        searchQuery,
        filteredNodes,
        filteredEdges,
        availableTypes,
        typeColorMap,
        loadGraph,
        setTypeFilter,
        toggleType,
        invalidate,
    };
});
