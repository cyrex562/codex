import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { vuetify } from './plugins/vuetify';
import { useAuthStore } from './stores/auth';

async function boot() {
    const app = createApp(App);

    app.use(createPinia());

    // Restore the desktop-durable refresh token (if any) before the router
    // evaluates its first navigation guard — otherwise the guard would see an
    // unauthenticated state, redirect to /login, and the restored token would
    // never get exercised. Browser deployments no-op through this call.
    await useAuthStore().bootstrapPersistence();

    app.use(router);
    app.use(vuetify);

    app.mount('#app');
}

void boot();
