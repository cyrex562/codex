import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { getLogger } from '@/utils/logger';

const log = getLogger('router');

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
            path: '/change-password',
            name: 'change-password',
            component: () => import('@/pages/ChangePasswordPage.vue'),
        },
        {
            path: '/admin/users',
            name: 'admin-users',
            component: () => import('@/pages/AdminUsersPage.vue'),
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'main',
            component: () => import('@/layouts/MainLayout.vue'),
        },
    ],
});

// Navigation guard — enforce login before entering app routes.
router.beforeEach(async (to) => {
    const auth = useAuthStore();

    if (to.meta.public) {
        if (to.name === 'login' && auth.isAuthenticated) {
            try {
                await auth.ensureFresh();
                await auth.loadProfile();
                return { path: '/' };
            } catch (err) {
                log.warn('public-route ensureFresh failed → forcing logout', {
                    to: to.fullPath,
                    message: (err as Error)?.message ?? String(err),
                });
                await auth.logout();
                return true;
            }
        }
        return true;
    }

    if (!auth.isAuthenticated) {
        log.info('unauthenticated navigation → /login', { to: to.fullPath });
        return { path: '/login', query: { redirect: to.fullPath } };
    }

    try {
        await auth.ensureFresh();
        await auth.loadProfile(true);

        if (auth.mustChangePassword && to.name !== 'change-password') {
            return { path: '/change-password', query: { redirect: to.fullPath } };
        }

        if (to.name === 'admin-users' && !auth.isAdmin) {
            return { path: '/' };
        }

        return true;
    } catch (err) {
        log.warn('guard ensureFresh/loadProfile failed → forcing logout + /login', {
            to: to.fullPath,
            message: (err as Error)?.message ?? String(err),
        });
        await auth.logout();
        return { path: '/login', query: { redirect: to.fullPath } };
    }
});

export default router;
