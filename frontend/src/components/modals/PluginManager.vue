<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        Plugins
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="plain" @click="close" />
      </v-card-title>

      <v-card-text style="max-height: 480px; overflow-y: auto;">
        <v-progress-linear v-if="loading" indeterminate class="mb-2" />

        <v-list density="compact">
          <v-list-item v-for="plugin in plugins" :key="plugin.id">
            <template #prepend>
              <v-switch
                :model-value="plugin.enabled"
                hide-details
                density="compact"
                @update:model-value="toggle(plugin.id, !plugin.enabled)"
              />
            </template>
            <v-list-item-title>{{ plugin.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ plugin.description }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <p v-if="!loading && plugins.length === 0" class="text-caption text-secondary text-center">
          No plugins installed.
        </p>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiListPlugins, apiTogglePlugin } from '@/api/client';

interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const plugins = ref<Plugin[]>([]);
const loading = ref(false);

watch(() => props.modelValue, async (open) => {
  if (open) await load();
});

async function load() {
  loading.value = true;
  try {
     const res = await apiListPlugins();
     plugins.value = (res.plugins ?? []) as Plugin[];
  } finally {
    loading.value = false;
  }
}

async function toggle(id: string, enable: boolean) {
  await apiTogglePlugin(id, enable);
  const p = plugins.value.find(pl => pl.id === id);
  if (p) p.enabled = enable;
}

function close() {
  emit('update:modelValue', false);
}
</script>
