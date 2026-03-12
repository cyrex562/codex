import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/login',
            name: 'login',
            component: () => import('@/pages/LoginPage.vue'),
            meta: { public: true },
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'main',
            component: () => import('@/layouts/MainLayout.vue'),
        },
    ],
});

// Navigation guard — only kicks in if auth is enabled (server returns 401 on /api/preferences)
router.beforeEach((to) => {
    if (to.meta.public) return true;
    const auth = useAuthStore();
    // If we have no token at all, the app will try to call the API and get a 401,
    // at which point the ApiError handler in the auth store will redirect.
    // We do not block navigation here because auth may be disabled on the server.
    return true;
});

export default router;
