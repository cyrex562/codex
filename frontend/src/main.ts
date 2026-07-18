import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { vuetify } from './plugins/vuetify';
import { getLogger } from './utils/logger';

const bootLog = getLogger('boot');
bootLog.info('frontend bundle loaded', {
    userAgent: navigator.userAgent,
    url: window.location.href,
});

// Top-level safety nets. Uncaught JS errors and unhandled promise rejections
// are the two ways a session-crash can otherwise disappear without a trace;
// funnel both through the logger so `frontend.log` shows what actually broke.
window.addEventListener('error', (event) => {
    getLogger('window').error('uncaught error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack,
    });
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    getLogger('window').error('unhandled promise rejection', {
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
    });
});

const app = createApp(App);

app.config.errorHandler = (err, _instance, info) => {
    getLogger('vue').error('Vue errorHandler', {
        message: err instanceof Error ? err.message : String(err),
        info,
        stack: err instanceof Error ? err.stack : undefined,
    });
};

app.use(createPinia());
app.use(router);
app.use(vuetify);

app.mount('#app');
