<template>
  <div class="list-field d-flex flex-column ga-2">
    <div
      v-for="(item, idx) in items"
      :key="idx"
      class="d-flex align-center ga-2"
    >
      <!-- entity_ref items -->
      <EntityRefField
        v-if="itemType === 'entity_ref'"
        :model-value="(item as string | null | undefined)"
        :target-label="targetLabel"
        :vault-id="vaultId"
        style="flex: 1;"
        @update:model-value="updateItem(idx, $event)"
      />

      <!-- enum items -->
      <v-select
        v-else-if="itemType === 'enum'"
        :model-value="item as string | null | undefined"
        :items="itemValues"
        density="compact"
        variant="outlined"
        hide-details
        style="flex: 1;"
        @update:model-value="updateItem(idx, $event)"
      />

      <!-- boolean items -->
      <v-switch
        v-else-if="itemType === 'boolean'"
        :model-value="!!item"
        color="primary"
        density="compact"
        hide-details
        style="flex: 1;"
        @update:model-value="updateItem(idx, $event)"
      />

      <!-- number items -->
      <v-text-field
        v-else-if="itemType === 'number'"
        :model-value="item"
        type="number"
        density="compact"
        variant="outlined"
        hide-details
        style="flex: 1;"
        @update:model-value="updateItem(idx, Number($event))"
      />

      <!-- string / date / text items -->
      <v-text-field
        v-else
        :model-value="String(item ?? '')"
        density="compact"
        variant="outlined"
        hide-details
        style="flex: 1;"
        @update:model-value="updateItem(idx, $event)"
      />

      <v-btn icon="mdi-close" size="x-small" variant="text" @click="removeItem(idx)" />
    </div>

    <v-btn
      size="x-small"
      variant="text"
      prepend-icon="mdi-plus"
      @click="addItem"
    >
      Add item
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FieldType } from '@/api/types';
import EntityRefField from './EntityRefField.vue';

const props = defineProps<{
    modelValue: unknown[] | null | undefined;
    itemType: FieldType;
    itemValues: string[];
    targetLabel?: string;
    vaultId: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: unknown[]];
}>();

const items = computed(() => (Array.isArray(props.modelValue) ? [...props.modelValue] : []));

function defaultItemValue(): unknown {
    switch (props.itemType) {
        case 'boolean': return false;
        case 'number': return 0;
        case 'enum': return props.itemValues[0] ?? '';
        default: return '';
    }
}

function updateItem(idx: number, value: unknown) {
    const next = [...items.value];
    next[idx] = value;
    emit('update:modelValue', next);
}

function removeItem(idx: number) {
    const next = [...items.value];
    next.splice(idx, 1);
    emit('update:modelValue', next);
}

function addItem() {
    emit('update:modelValue', [...items.value, defaultItemValue()]);
}
</script>
