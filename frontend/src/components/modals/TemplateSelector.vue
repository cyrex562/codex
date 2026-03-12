<template>
  <v-dialog :model-value="modelValue" max-width="640" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        Insert Template
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="plain" @click="close" />
      </v-card-title>

      <v-card-text>
        <v-alert
          v-if="!isMarkdownTab"
          type="warning"
          variant="tonal"
          class="mb-3"
        >
          Templates can only be inserted into an active markdown tab.
        </v-alert>

        <v-progress-linear v-if="loading" indeterminate class="mb-3" />

        <div v-if="!loading && templates.length === 0" class="text-center py-6">
          <p class="text-body-2 mb-2">No templates found.</p>
          <p class="text-caption text-secondary mb-4">Create a <code>Templates</code> folder with markdown files, or let me bootstrap the classics.</p>
          <v-btn color="primary" :disabled="!vaultsStore.activeVaultId" @click="createDefaults">
            Create Default Templates
          </v-btn>
        </div>

        <v-list v-else density="comfortable">
          <v-list-item
            v-for="template in templates"
            :key="template.path"
            :title="template.name"
            :subtitle="template.path"
            :disabled="!isMarkdownTab"
            prepend-icon="mdi-file-document-outline"
            @click="insertTemplate(template.path)"
          />
        </v-list>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FileNode } from '@/api/types';
import { useVaultsStore } from '@/stores/vaults';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const vaultsStore = useVaultsStore();
const filesStore = useFilesStore();
const tabsStore = useTabsStore();

const templates = ref<FileNode[]>([]);
const loading = ref(false);

const activeTab = computed(() => tabsStore.activeTab);
const isMarkdownTab = computed(() => activeTab.value?.fileType === 'markdown');

watch(() => props.modelValue, async (open) => {
    if (open) {
        await loadTemplates();
    }
});

function close() {
    emit('update:modelValue', false);
}

function findTemplatesFolder(nodes: FileNode[]): FileNode | null {
    for (const node of nodes) {
        if (node.is_directory && node.name.toLowerCase() === 'templates') return node;
        if (node.children) {
            const found = findTemplatesFolder(node.children);
            if (found) return found;
        }
    }
    return null;
}

async function loadTemplates() {
    templates.value = [];
    const vaultId = vaultsStore.activeVaultId;
    if (!vaultId) return;

    loading.value = true;
    try {
        await filesStore.loadTree(vaultId);
        const folder = findTemplatesFolder(filesStore.tree);
        templates.value = folder?.children?.filter((node) => !node.is_directory && node.name.endsWith('.md')) ?? [];
    } finally {
        loading.value = false;
    }
}

function applyTemplateVariables(content: string): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const title = activeTab.value?.fileName.replace(/\.md$/i, '') ?? '';

    return content
        .replace(/{{date}}/g, dateStr)
        .replace(/{{time}}/g, timeStr)
        .replace(/{{datetime}}/g, `${dateStr} ${timeStr}`)
        .replace(/{{title}}/g, title);
}

async function insertTemplate(templatePath: string) {
    const vaultId = vaultsStore.activeVaultId;
    const tab = activeTab.value;
    if (!vaultId || !tab || tab.fileType !== 'markdown') return;

    const template = await filesStore.readFile(vaultId, templatePath);
    const processed = applyTemplateVariables(template.content);
    const separator = tab.content.trim().length > 0 ? '\n\n' : '';
    tabsStore.updateTabContent(tab.id, `${tab.content}${separator}${processed}`);
    close();
}

async function createDefaults() {
    const vaultId = vaultsStore.activeVaultId;
    if (!vaultId) return;

    try {
        try {
            await filesStore.createDirectory(vaultId, 'Templates');
        } catch {
            // Fine if it already exists.
        }

        await filesStore.createFile(vaultId, 'Templates/Daily Note.md', '# {{date}}\n\n## Tasks\n- [ ] \n\n## Notes\n');
        await filesStore.createFile(vaultId, 'Templates/Meeting Note.md', '# {{title}}\nDate: {{datetime}}\n\n## Attendees\n\n## Agenda\n\n## Notes\n');
        await loadTemplates();
    } catch (error) {
        console.error('Failed to create default templates:', error);
    }
}
</script>
