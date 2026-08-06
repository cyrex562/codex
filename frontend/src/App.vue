<template>
  <v-app :theme="theme">
    <router-view />
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { usePreferencesStore } from '@/stores/preferences';
import { useAuthStore } from '@/stores/auth';
import { getLogger } from '@/utils/logger';

const log = getLogger('app');

const prefsStore = usePreferencesStore();
const authStore = useAuthStore();
const router = useRouter();

// Vuetify theme name driven by user preference
const theme = computed(() =>
  prefsStore.prefs.theme === 'dark' ? 'obsidianDark' : 'obsidianLight',
);

// Bootstrap: load preferences, then open WS
onMounted(async () => {
  const isLoginRoute = router.currentRoute.value.path === '/login';
  log.info('App onMounted', {
    startingRoute: router.currentRoute.value.fullPath,
    isAuthenticatedAtBoot: authStore.isAuthenticated,
  });

  if (authStore.isAuthenticated || !isLoginRoute) {
    await prefsStore.load();
  }

  if (authStore.isAuthenticated) {
    try {
      await authStore.ensureFresh();
      await authStore.loadProfile();
    } catch (err) {
      log.warn('App mount ensureFresh/loadProfile failed → logout + /login', {
        message: (err as Error)?.message ?? String(err),
      });
      await authStore.logout();
      if (router.currentRoute.value.path !== '/login') {
        await router.replace({
          path: '/login',
          query: { redirect: router.currentRoute.value.fullPath || '/' },
        });
      }
    }
  }
});
</script>

<style>
/* Global resets — keep Obsidian feel inside Vuetify */
html, body {
  overflow: hidden;
  height: 100vh;
}

* {
  box-sizing: border-box;
}

body {
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100vh;
}

/* Monospace for editor areas */
.mono {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}

/* ── Touch ergonomics ─────────────────────────────────────────────────────────
   On coarse-pointer (touch) devices, grow the primary interactive rows to a
   comfortable tap size. Scoped to pointer type, not viewport width, so a
   touch laptop benefits too and a narrow desktop window is unaffected. */
@media (pointer: coarse) {
  /* File tree rows (28px mouse target → 42px touch target). Long-press on a
     row fires `contextmenu` on Android, opening the existing context menu. */
  .file-tree-node {
    min-height: 42px !important;
  }
  /* Sidebar panel headers and list rows */
  .v-list-item--density-compact.v-list-item--one-line {
    min-height: 40px;
  }
  /* Editor toolbar buttons: compact-density v-btns are ~28px; pad them up */
  .editor-toolbar .v-btn--density-compact {
    --v-btn-height: 36px;
    width: 36px;
  }
  /* Tab close buttons and other x-small icon buttons */
  .v-btn--size-x-small.v-btn--icon {
    --v-btn-height: 32px;
  }
}

.text-secondary {
  color: rgb(var(--v-theme-secondary)) !important;
}

/* Rendered markdown content */
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  margin: 0.75em 0 0.4em;
  font-weight: 600;
}
.markdown-body p { margin-bottom: 0.8em; }
.markdown-body code {
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 3px;
  padding: 0.1em 0.35em;
  font-size: 0.88em;
}
.markdown-body pre code {
  background: none;
  padding: 0;
}
.markdown-body pre {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-border));
  border-radius: 6px;
  padding: 1em;
  overflow-x: auto;
  margin-bottom: 1em;
}
.markdown-body blockquote {
  border-left: 3px solid rgb(var(--v-theme-primary));
  margin: 0.5em 0;
  padding: 0.25em 1em;
  color: rgb(var(--v-theme-secondary));
}
.markdown-body a {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.markdown-body a:hover {
  text-decoration: underline;
  filter: brightness(1.15);
}
.markdown-body table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
.markdown-body th, .markdown-body td {
  border: 1px solid rgb(var(--v-theme-border));
  padding: 0.5em 0.75em;
}
.markdown-body th { background: rgb(var(--v-theme-surface-light)); }
</style>
