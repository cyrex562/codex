<template>
  <div class="viewer pdf-viewer" style="flex: 1; overflow: hidden; display: flex; flex-direction: column; background: #525659;">
    <!-- Toolbar -->
    <div class="d-flex align-center justify-center gap-3 pa-1" style="background: #3a3a3a; flex-shrink: 0;">
      <v-btn icon="mdi-chevron-left" size="small" density="compact" :disabled="page <= 1" @click="page--" />
      <span class="text-caption" style="color: #eee;">{{ page }} / {{ totalPages }}</span>
      <v-btn icon="mdi-chevron-right" size="small" density="compact" :disabled="page >= totalPages" @click="page++" />
      <v-btn icon="mdi-minus" size="small" density="compact" @click="scale = Math.max(0.25, scale - 0.25)" />
      <span class="text-caption" style="color: #eee;">{{ Math.round(scale * 100) }}%</span>
      <v-btn icon="mdi-plus" size="small" density="compact" @click="scale = Math.min(4, scale + 0.25)" />
    </div>

    <!-- Canvas -->
    <div style="flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: center; padding: 16px;">
      <canvas ref="canvasRef" />
    </div>

    <div v-if="error" class="text-center text-caption pa-4" style="color: #ef4444;">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';

// Point at the bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const props = defineProps<{ vaultId: string; path: string }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const page = ref(1);
const totalPages = ref(0);
const scale = ref(1.5);
const error = ref('');

let pdfDoc: any = null;
let renderTask: any = null;

onMounted(() => loadPdf());

onUnmounted(() => {
  renderTask?.cancel();
  pdfDoc = null;
});

watch(() => [props.vaultId, props.path], () => loadPdf());
watch([page, scale], () => renderPage());

async function loadPdf() {
  error.value = '';
  if (!props.vaultId || !props.path) return;
  try {
    const url = `/api/vaults/${props.vaultId}/files/${encodeURIComponent(props.path)}/download`;
    const loadingTask = pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise as any;
    totalPages.value = (pdfDoc as any).numPages;
    page.value = 1;
    await renderPage();
  } catch (e: any) {
    error.value = `Failed to load PDF: ${e?.message ?? e}`;
  }
}

async function renderPage() {
  if (!pdfDoc || !canvasRef.value) return;
  renderTask?.cancel();
  try {
    const p = await (pdfDoc as any).getPage(page.value);
    const viewport = p.getViewport({ scale: scale.value });
    const canvas = canvasRef.value;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    renderTask = p.render({ canvasContext: ctx, viewport }) as any;
    await (renderTask as any).promise;
  } catch {
    // Render cancelled — no-op
  }
}
</script>
