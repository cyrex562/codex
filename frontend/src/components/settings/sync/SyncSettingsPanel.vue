<template>
  <div>
    <RemotesSection @changed="bumpRefreshKey" />

    <v-divider class="my-6" />

    <VaultMappingSection :key="refreshKey" @changed="bumpRefreshKey" />

    <v-divider class="my-6" />

    <SyncStatusSection />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import RemotesSection from '@/components/settings/sync/RemotesSection.vue';
import VaultMappingSection from '@/components/settings/sync/VaultMappingSection.vue';
import SyncStatusSection from '@/components/settings/sync/SyncStatusSection.vue';

const refreshKey = ref(0);

function bumpRefreshKey() {
  refreshKey.value += 1;
}
</script>
