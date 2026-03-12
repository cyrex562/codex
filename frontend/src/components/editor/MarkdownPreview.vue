<template>
  <div ref="previewEl" class="markdown-preview markdown-body pa-4" v-html="renderedHtml" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import DOMPurify from 'dompurify';
import { apiRenderMarkdownInVault, apiResolveWikiLink } from '@/api/client';
import { useTabsStore } from '@/stores/tabs';

const props = defineProps<{
  content: string;
  vaultId: string;
  currentFile?: string;
}>();

const tabsStore = useTabsStore();
const previewEl = ref<HTMLElement | null>(null);
const renderedHtml = ref('');
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  render();
  previewEl.value?.addEventListener('click', onPreviewClick);
});

onUnmounted(() => {
  previewEl.value?.removeEventListener('click', onPreviewClick);
});

watch(() => [props.content, props.vaultId, props.currentFile], () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, 400);
});

async function render() {
  if (!props.vaultId || !props.content) {
    renderedHtml.value = '';
    return;
  }
  try {
    const html = await apiRenderMarkdownInVault(props.vaultId, props.content, props.currentFile);
    // Sanitize server-returned HTML before inserting into DOM (XSS prevention)
    renderedHtml.value = DOMPurify.sanitize(html, {
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling'],
    });
    await nextTick();
  } catch {
    // Fall through silently on transient errors; keep last rendered content
  }
}

async function onPreviewClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest('a') as HTMLAnchorElement | null;
  if (!anchor) return;

  if (anchor.classList.contains('wiki-link')) {
    event.preventDefault();
    event.stopPropagation();

    const originalLink = anchor.getAttribute('data-original-link') ?? anchor.textContent ?? '';
    const [linkTarget] = originalLink.split('#');
    if (!props.vaultId || !linkTarget) return;

    try {
      const resolved = await apiResolveWikiLink(props.vaultId, linkTarget, props.currentFile);
      if (resolved.exists) {
        tabsStore.openTab(tabsStore.activePaneId, resolved.path, resolved.path.split('/').pop() ?? resolved.path);
      }
    } catch {
      // no-op for now
    }
    return;
  }

  const href = anchor.getAttribute('href');
  if (href && !href.startsWith('#') && !href.startsWith('http://') && !href.startsWith('https://')) {
    event.preventDefault();
    tabsStore.openTab(tabsStore.activePaneId, href, href.split('/').pop() ?? href);
  }
}
</script>

<style scoped>
.markdown-preview {
  flex: 1;
  overflow-y: auto;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  border-left: 1px solid rgb(var(--v-theme-border));
  font-size: 15px;
  line-height: 1.7;
}
</style>
