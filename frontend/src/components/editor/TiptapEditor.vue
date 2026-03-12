<template>
  <div class="tiptap-wrapper">
    <editor-content :editor="editor" class="tiptap-editor" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';

const props = defineProps<{
  tabId: string;
  content: string;
}>();

const emit = defineEmits<{ update: [value: string] }>();

const editor = useEditor({
  content: props.content,
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: 'Start writing…' }),
    CharacterCount,
  ],
  onUpdate({ editor }) {
    // Export as plain markdown-flavored text.
    // Tiptap outputs HTML by default; we emit the text version for persisting.
    emit('update', editor.getText({ blockSeparator: '\n\n' }));
  },
  editorProps: {
    attributes: {
      class: 'tiptap-inner',
    },
  },
});

// Sync external content changes without infinite loop
watch(() => props.content, (newVal) => {
  if (!editor.value) return;
  const current = editor.value.getText({ blockSeparator: '\n\n' });
  if (current !== newVal) {
    editor.value.commands.setContent(newVal, { emitUpdate: false });
  }
});

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<style>
.tiptap-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tiptap-editor {
  flex: 1;
  overflow-y: auto;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  padding: 16px;
}
.tiptap-inner {
  outline: none;
  min-height: 100%;
  font-size: 15px;
  line-height: 1.7;
}
.tiptap-inner p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: rgba(var(--v-theme-on-background), 0.4);
  pointer-events: none;
  float: left;
  height: 0;
}
</style>
