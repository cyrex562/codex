<template>
  <div ref="editorEl" class="markdown-editor" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useUndoRedo } from '@/composables/useUndoRedo';
import { highlight } from '@/utils/highlight';

const props = defineProps<{
  tabId: string;
  content: string;
}>();

const emit = defineEmits<{ update: [value: string] }>();

const editorEl = ref<HTMLElement | null>(null);
let jar: any = null;
let ignoreNextChange = false;

const { recordChange, undo, redo } = useUndoRedo(props.tabId) as any;

onMounted(async () => {
  if (!editorEl.value) return;
  // CodeJar is a ~1kB editor; loaded dynamically from vendor dir or npm
  const { CodeJar } = await import('codejar');
  jar = CodeJar(editorEl.value, highlight, { tab: '  ' });
  jar.updateCode(props.content);
  jar.onUpdate((code: string) => {
    if (ignoreNextChange) { ignoreNextChange = false; return; }
    recordChange(code);
    emit('update', code);
  });

  editorEl.value.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  editorEl.value?.removeEventListener('keydown', onKeydown);
  jar = null;
});

// Sync external content changes (e.g. WS reload) without double-emitting
watch(() => props.content, (newVal) => {
  if (!jar) return;
  if (jar.toString() !== newVal) {
    ignoreNextChange = true;
    jar.updateCode(newVal);
  }
});

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    const prev = undo();
    if (prev != null && prev !== jar?.toString()) {
      ignoreNextChange = true;
      jar?.updateCode(prev);
      emit('update', prev);
    }
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    const next = redo();
    if (next != null && next !== jar?.toString()) {
      ignoreNextChange = true;
      jar?.updateCode(next);
      emit('update', next);
    }
  }
}
</script>

<style>
.markdown-editor {
  flex: 1;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.6;
  padding: 16px;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  overflow-y: auto;
  tab-size: 2;
  caret-color: rgb(var(--v-theme-primary));
}
</style>
