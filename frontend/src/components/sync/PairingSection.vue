<template>
  <div>
    <template v-if="!syncStore.isPaired">
      <p class="text-body-2 text-medium-emphasis mb-3">
        Pair this device with a Librarium server to sync a vault offline.
      </p>

      <v-alert v-if="pairError" type="error" variant="tonal" class="mb-3">{{ pairError }}</v-alert>

      <v-text-field
        v-model="baseUrl"
        label="Server URL"
        hint="e.g. https://sync.example.com"
        persistent-hint
        autofocus
        class="mb-2"
        data-testid="pairing-base-url"
      />
      <v-text-field
        v-model="apiKey"
        label="API key"
        :type="showApiKey ? 'text' : 'password'"
        :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
        class="mb-2"
        data-testid="pairing-api-key"
        @click:append-inner="showApiKey = !showApiKey"
      />
      <v-btn
        color="primary"
        :loading="pairing"
        :disabled="!baseUrl.trim() || !apiKey.trim()"
        data-testid="pairing-pair-btn"
        @click="doPair"
      >
        Pair
      </v-btn>
    </template>

    <template v-else>
      <div class="d-flex justify-space-between align-center mb-3">
        <div>
          <p class="text-body-2">
            Paired with <strong>{{ syncStore.pairing?.base_url }}</strong>
          </p>
          <p class="text-caption text-medium-emphasis">API key stored securely on this device.</p>
        </div>
        <v-btn
          size="small"
          variant="tonal"
          color="error"
          :loading="unpairing"
          data-testid="pairing-unpair-btn"
          @click="doUnpair"
        >
          Unpair
        </v-btn>
      </div>

      <v-alert v-if="unpairError" type="error" variant="tonal" class="mb-3">{{ unpairError }}</v-alert>

      <v-alert v-if="!syncStore.hasAnyMapping" type="info" variant="tonal" class="mb-3">
        Map a vault to this remote to start syncing.
      </v-alert>
      <v-btn
        v-else-if="!showMapAnother"
        size="small"
        variant="outlined"
        class="mb-2"
        data-testid="pairing-map-another-btn"
        @click="showMapAnother = true"
      >
        Map another vault
      </v-btn>

      <VaultMappingSection
        v-if="!syncStore.hasAnyMapping || showMapAnother"
        @changed="onMappingChanged"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSyncStore } from '@/stores/sync';
import VaultMappingSection from '@/components/settings/sync/VaultMappingSection.vue';

const syncStore = useSyncStore();

const baseUrl = ref('');
const apiKey = ref('');
const showApiKey = ref(false);
const pairing = ref(false);
const pairError = ref('');

const unpairing = ref(false);
const unpairError = ref('');
const showMapAnother = ref(false);

async function doPair() {
  const url = baseUrl.value.trim();
  const key = apiKey.value.trim();
  if (!url || !key) return;

  pairing.value = true;
  pairError.value = '';
  try {
    await syncStore.pair(url, key);
    // Never keep the API key around after entry (#54).
    apiKey.value = '';
  } catch (e: any) {
    pairError.value = e?.message ?? 'Failed to pair with the server.';
  } finally {
    pairing.value = false;
  }
}

async function doUnpair() {
  if (!confirm(`Unpair from "${syncStore.pairing?.base_url}"? This will stop syncing.`)) {
    return;
  }

  unpairing.value = true;
  unpairError.value = '';
  try {
    await syncStore.unpair();
    showMapAnother.value = false;
  } catch (e: any) {
    unpairError.value = e?.message ?? 'Failed to unpair.';
  } finally {
    unpairing.value = false;
  }
}

async function onMappingChanged() {
  showMapAnother.value = false;
  await syncStore.refreshStatus();
}
</script>
