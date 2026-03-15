<template>
  <v-dialog :model-value="modelValue" max-width="760" @update:model-value="onDialogToggle">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Import files and folders</span>
        <v-chip size="small" variant="tonal" color="primary">
          {{ summaryLabel }}
        </v-chip>
      </v-card-title>

      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-3">
          {{ error }}
        </v-alert>
        <v-alert v-if="success" type="success" variant="tonal" class="mb-3">
          {{ success }}
        </v-alert>

        <v-text-field
          v-model="targetPath"
          label="Target folder inside vault"
          hint="Leave blank to import into the vault root. Dropping onto a folder pre-fills this for you."
          persistent-hint
          density="comfortable"
          prepend-inner-icon="mdi-folder-outline"
        />

        <div
          class="import-dropzone pa-6 mb-3"
          :class="{ 'import-dropzone-active': dragging }"
          data-testid="import-dropzone"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <v-icon icon="mdi-tray-arrow-up" size="40" color="primary" class="mb-2" />
          <div class="text-subtitle-2 mb-1">Drag files or whole folders here</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            Folder structure is preserved automatically during import.
          </div>

          <div class="d-flex flex-wrap ga-2 justify-center">
            <v-btn color="primary" variant="tonal" @click="pickFiles">Choose files</v-btn>
            <v-btn color="primary" variant="outlined" @click="pickFolder">Choose folder</v-btn>
            <v-btn variant="text" :disabled="entries.length === 0 || importing" @click="clearEntries">Clear list</v-btn>
          </div>
        </div>

        <input
          ref="filesInput"
          data-testid="import-files-input"
          type="file"
          multiple
          style="display: none"
          @change="onFilesSelected"
        />
        <input
          ref="folderInput"
          data-testid="import-folder-input"
          type="file"
          multiple
          webkitdirectory
          directory
          style="display: none"
          @change="onFolderSelected"
        />

        <div class="d-flex align-center justify-space-between mb-2">
          <div class="text-caption text-medium-emphasis">
            {{ entries.length }} item<span v-if="entries.length !== 1">s</span> queued · {{ formattedTotalSize }}
            <span v-if="archiveCount > 0" class="ml-1 text-primary">({{ archiveCount }} archive<span v-if="archiveCount !== 1">s</span> will be extracted)</span>
          </div>
          <div class="text-caption text-medium-emphasis" v-if="normalizedTargetPath">
            Importing into <code>{{ normalizedTargetPath }}</code>
          </div>
        </div>

        <v-select
          v-model="conflictStrategy"
          label="If a file already exists"
          :items="conflictOptions"
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />

        <v-list v-if="entries.length > 0" density="compact" class="import-list mb-3">
          <v-list-item
            v-for="entry in entriesPreview"
            :key="entry.relativePath + entry.file.lastModified"
            :title="entry.relativePath"
            :subtitle="formatBytes(entry.file.size)"
          />
          <v-list-item v-if="entries.length > entriesPreview.length" :title="`+${entries.length - entriesPreview.length} more`" />
        </v-list>
        <div v-else class="text-body-2 text-medium-emphasis mb-3">
          No files queued yet. Pick files, pick a folder, or drop them into the box above.
        </div>

        <div v-if="importing || progress" class="mt-2">
          <div class="d-flex justify-space-between text-caption mb-1">
            <span>{{ progressLabel }}</span>
            <span>{{ percentage }}%</span>
          </div>
          <v-progress-linear :model-value="percentage" color="primary" height="10" rounded />
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="importing" @click="close">Close</v-btn>
        <v-btn
          color="primary"
          :loading="importing"
          :disabled="entries.length === 0 || !vaultsStore.activeVaultId"
          @click="startImport"
        >
          Import {{ entries.length > 0 ? entries.length : '' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useUiStore } from '@/stores/ui';
import { useVaultsStore } from '@/stores/vaults';
import type { ImportCandidate, ImportProgress } from '@/api/types';
import {
  createImportCandidatesFromDataTransfer,
  createImportCandidatesFromFileList,
  hasFilePayload,
  normalizeImportPath,
} from '@/utils/importEntries';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const filesStore = useFilesStore();
const uiStore = useUiStore();
const vaultsStore = useVaultsStore();

const filesInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const importing = ref(false);
const error = ref('');
const success = ref('');
const progress = ref<ImportProgress | null>(null);
const targetPath = ref('');
const conflictStrategy = ref<'fail' | 'overwrite' | 'rename_with_timestamp'>('rename_with_timestamp');

const conflictOptions = [
    { title: 'Keep both (append timestamp)', value: 'rename_with_timestamp' },
    { title: 'Overwrite existing file', value: 'overwrite' },
    { title: 'Skip / fail', value: 'fail' },
];

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      targetPath.value = uiStore.importTargetPath;
      error.value = '';
      success.value = '';
    }
  },
  { immediate: true },
);

watch(targetPath, (value) => {
  uiStore.importTargetPath = normalizeImportPath(value);
});

const entries = computed(() => uiStore.importEntries);
const entriesPreview = computed(() => entries.value.slice(0, 12));
const totalSize = computed(() => entries.value.reduce((sum, entry) => sum + entry.file.size, 0));
const formattedTotalSize = computed(() => formatBytes(totalSize.value));
const normalizedTargetPath = computed(() => normalizeImportPath(targetPath.value));
const archiveCount = computed(() =>
    entries.value.filter((e) => {
        const name = e.file.name.toLowerCase();
        return name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.tar.gz') || name.endsWith('.tgz');
    }).length,
);
const summaryLabel = computed(() => {
  if (entries.value.length === 0) return 'Ready';
  return `${entries.value.length} queued`;
});
const percentage = computed(() => {
  if (!progress.value || progress.value.totalBytes === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.value.uploadedBytes / progress.value.totalBytes) * 100)));
});
const progressLabel = computed(() => {
  if (!progress.value) return 'Waiting to import';
  const current = progress.value.currentFile ? ` · ${progress.value.currentFile}` : '';
  return `Imported ${progress.value.completedFiles}/${progress.value.totalFiles}${current}`;
});

function onDialogToggle(value: boolean) {
  emit('update:modelValue', value);
  if (!value) {
    uiStore.closeImportDialog();
  }
}

function close() {
  onDialogToggle(false);
}

function pickFiles() {
  filesInput.value?.click();
}

function pickFolder() {
  folderInput.value?.click();
}

function clearEntries() {
  uiStore.clearImportEntries();
  success.value = '';
  error.value = '';
}

function queueEntries(nextEntries: ImportCandidate[]) {
  if (nextEntries.length === 0) return;
  uiStore.setImportEntries(dedupeEntries([...entries.value, ...nextEntries]));
  success.value = '';
  error.value = '';
}

function onFilesSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  queueEntries(createImportCandidatesFromFileList(input.files));
  input.value = '';
}

function onFolderSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  queueEntries(createImportCandidatesFromFileList(input.files));
  input.value = '';
}

function onDragEnter(e: DragEvent) {
  if (!hasFilePayload(e.dataTransfer)) return;
  dragging.value = true;
}

function onDragOver(e: DragEvent) {
  if (!hasFilePayload(e.dataTransfer)) return;
  dragging.value = true;
}

function onDragLeave(e: DragEvent) {
  const nextTarget = e.relatedTarget as Node | null;
  if (nextTarget && (e.currentTarget as HTMLElement | null)?.contains(nextTarget)) {
    return;
  }
  dragging.value = false;
}

async function onDrop(e: DragEvent) {
  dragging.value = false;
  if (!e.dataTransfer || !hasFilePayload(e.dataTransfer)) return;
  queueEntries(await createImportCandidatesFromDataTransfer(e.dataTransfer));
}

async function startImport() {
  const vaultId = vaultsStore.activeVaultId;
  if (!vaultId || entries.value.length === 0) return;

  importing.value = true;
  error.value = '';
  success.value = '';
  progress.value = null;

  try {
    const result = await filesStore.importCandidates(
      vaultId,
      entries.value,
      normalizedTargetPath.value,
      (nextProgress) => {
        progress.value = nextProgress;
      },
      conflictStrategy.value,
    );

    success.value = `Imported ${result.uploaded.length} file${result.uploaded.length === 1 ? '' : 's'} successfully.`;
    uiStore.clearImportEntries();
  } catch (e: any) {
    error.value = e?.message ?? 'Import failed.';
  } finally {
    importing.value = false;
  }
}

function formatBytes(value: number): string {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;
  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function dedupeEntries(nextEntries: ImportCandidate[]): ImportCandidate[] {
  const seen = new Set<string>();
  return nextEntries.filter((entry) => {
    const key = [entry.relativePath, entry.file.size, entry.file.lastModified].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
</script>

<style scoped>
.import-dropzone {
  border: 2px dashed rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  text-align: center;
  background: rgba(var(--v-theme-primary), 0.04);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.import-dropzone-active {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.7);
}

.import-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-border), 1);
  border-radius: 8px;
}
</style>
