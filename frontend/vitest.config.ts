import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { resolve } from 'path';

export default defineConfig({
    // vuetify()'s autoImport is what resolves `<v-card>` etc. to real
    // components at compile time (vite.config.ts does the same for the real
    // build) — without it, any test that mounts a component using Vuetify
    // tags fails to resolve them.
    // `styles: 'none'` — component tests don't need real CSS, and per-component
    // style imports are what break under Vitest's (non-browser) transform.
    plugins: [vue(), vuetify({ autoImport: true, styles: 'none' })],
    test: {
        environment: 'happy-dom',
        include: ['src/**/*.test.ts'],
        globals: true,
        setupFiles: ['./src/test-setup.ts'],
        // Without this, Vitest treats `vuetify` as an external Node import
        // (bypassing Vite's transform) and its internal per-component `.css`
        // imports hit Node's loader directly, which can't parse CSS.
        server: {
            deps: { inline: [/vuetify/] },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});
