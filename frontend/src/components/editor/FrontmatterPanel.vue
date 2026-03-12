<template>
  <v-expansion-panels v-model="open" flat style="background: transparent; border-bottom: 1px solid rgb(var(--v-theme-border));">
    <v-expansion-panel>
      <v-expansion-panel-title class="text-caption font-weight-bold" style="min-height: 32px;">
        Frontmatter
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <div class="d-flex flex-wrap gap-2 py-1">
          <template v-for="(val, key) in localFm" :key="key">
            <v-chip
              size="small"
              closable
              @click:close="removeKey(key)"
            >
              <strong>{{ key }}:</strong>&nbsp;
              <v-text-field
                :model-value="String(val)"
                hide-details
                density="compact"
                variant="plain"
                style="max-width: 120px; font-size: 12px;"
                @update:model-value="localFm[key] = $event"
                @change="emitUpdate"
              />
            </v-chip>
          </template>

          <!-- Add new key -->
          <v-chip size="small" @click="addingKey = true" v-if="!addingKey">
            <v-icon icon="mdi-plus" size="14" />
          </v-chip>
          <div v-if="addingKey" class="d-flex align-center gap-1">
            <v-text-field
              v-model="newKey"
              placeholder="key"
              autofocus
              hide-details
              density="compact"
              variant="outlined"
              style="max-width: 80px; font-size: 12px;"
              @keyup.enter="confirmAdd"
              @keyup.esc="addingKey = false"
            />
            <v-text-field
              v-model="newVal"
              placeholder="value"
              hide-details
              density="compact"
              variant="outlined"
              style="max-width: 120px; font-size: 12px;"
              @keyup.enter="confirmAdd"
              @keyup.esc="addingKey = false"
            />
            <v-btn size="x-small" icon="mdi-check" @click="confirmAdd" />
          </div>
        </div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { useTabsStore } from '@/stores/tabs';

const props = defineProps<{
  tabId: string;
  frontmatter: Record<string, unknown>;
}>();

const tabsStore = useTabsStore();
const open = ref(0);
const addingKey = ref(false);
const newKey = ref('');
const newVal = ref('');

const localFm = reactive<Record<string, unknown>>({ ...props.frontmatter });

watch(() => props.frontmatter, (fm) => {
  Object.assign(localFm, fm);
});

function emitUpdate() {
  tabsStore.updateTabFrontmatter(props.tabId, { ...localFm });
}

function removeKey(key: string) {
  delete localFm[key];
  emitUpdate();
}

function confirmAdd() {
  if (newKey.value.trim()) {
    localFm[newKey.value.trim()] = newVal.value;
    emitUpdate();
  }
  newKey.value = '';
  newVal.value = '';
  addingKey.value = false;
}
</script>
