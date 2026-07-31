<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <v-card width="100%" max-width="520">
      <v-card-title class="text-center pa-6">
        <v-icon icon="mdi-cloud-sync-outline" size="40" color="primary" />
        <div class="mt-2 text-h6">Set up sync</div>
        <div class="text-caption text-medium-emphasis mt-1">
          This device works offline — pair it with your Librarium server once
          to start syncing a vault.
        </div>
      </v-card-title>

      <v-card-text>
        <PairingSection />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import PairingSection from '@/components/sync/PairingSection.vue';
</script>
