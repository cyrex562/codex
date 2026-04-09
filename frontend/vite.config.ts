import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { resolve } from 'path';

export default defineConfig({
    plugins: [
        vue(),
        vuetify({ autoImport: true }),
    ],
    base: '/',
    build: {
        // Cap to ES2020 for WebKitGTK 2.36 compatibility (Ubuntu 22.04 LTS).
        // ES2021+ features (e.g. logical assignment `??=`) are not supported by
        // WebKitGTK 2.36's JavaScriptCore engine.
        target: 'es2020',
        outDir: '../target/frontend',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    if (id.includes('vuetify')) return 'vendor-vuetify';
                    if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-tiptap';
                    if (id.includes('pdfjs-dist')) return 'vendor-pdf';
                    if (id.includes('highlight.js') || id.includes('codejar')) return 'vendor-editor';
                    return 'vendor';
                },
            },
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8080',
                changeOrigin: true,
                ws: true,  // proxies WebSocket upgrades for /api/ws
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});
