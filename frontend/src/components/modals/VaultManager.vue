<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        Vault Manager
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="plain" @click="close" />
      </v-card-title>

      <v-card-text style="max-height: 400px; overflow-y: auto;">
        <v-list density="compact">
          <v-list-item
            v-for="vault in vaultsStore.vaults"
            :key="vault.id"
            :title="vault.name"
            :subtitle="vault.path"
            :active="vault.id === vaultsStore.activeVaultId"
            active-color="primary"
            @click="vaultsStore.setActiveVault(vault.id)"
          >
            <template #append>
              <v-btn
                icon="mdi-delete-outline"
                size="x-small"
                density="compact"
                variant="plain"
                base-color="error"
                @click.stop="deleteVault(vault.id)"
              />
            </template>
          </v-list-item>
        </v-list>

        <v-divider class="my-3" />

        <!-- Add vault form -->
        <p class="text-caption font-weight-bold mb-2">Add Vault</p>
        <v-text-field v-model="newName" label="Name" density="compact" />
        <v-text-field v-model="newPath" label="Path on server" density="compact" hint="Absolute path on the server filesystem" />
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="close">Close</v-btn>
        <v-btn color="primary" :disabled="!newName || !newPath" :loading="saving" @click="addVault">Add</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useVaultsStore } from '@/stores/vaults';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const vaultsStore = useVaultsStore();
const newName = ref('');
const newPath = ref('');
const saving = ref(false);

function close() {
  emit('update:modelValue', false);
}

async function addVault() {
  if (!newName.value || !newPath.value) return;
  saving.value = true;
  try {
    await vaultsStore.createVault({ name: newName.value, path: newPath.value });
    newName.value = '';
    newPath.value = '';
  } finally {
    saving.value = false;
  }
}

async function deleteVault(id: string) {
  if (!confirm('Delete this vault? (Files are not deleted from disk)')) return;
  await vaultsStore.deleteVault(id);
}
</script>
