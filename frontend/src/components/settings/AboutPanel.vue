<template>
  <div>
    <h2 class="text-h6 mb-1">About</h2>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Build information for the server this app is talking to.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-card v-if="info">
      <v-list density="comfortable">
        <v-list-item title="Version" :subtitle="info.version" />
        <v-list-item title="Build">
          <template #subtitle>
            <div class="d-flex align-center ga-2">
              <code>{{ info.git_hash }}</code>
              <v-btn
                size="x-small"
                variant="text"
                :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
                :color="copied ? 'success' : undefined"
                title="Copy commit hash"
                @click="copyHash"
              />
            </div>
          </template>
        </v-list-item>
        <v-list-item title="Built" :subtitle="info.build_date" />
      </v-list>
    </v-card>
    <v-skeleton-loader v-else-if="loading" type="list-item-three-line" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiGetVersion, type VersionInfo } from '@/api/client';

const info = ref<VersionInfo | null>(null);
const loading = ref(false);
const error = ref('');
const copied = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    info.value = await apiGetVersion();
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load version info.';
  } finally {
    loading.value = false;
  }
}

async function copyHash() {
  if (!info.value) return;
  try {
    await navigator.clipboard.writeText(info.value.git_hash);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    // Clipboard access denied — the hash is still visible to copy manually.
  }
}

onMounted(load);
</script>
