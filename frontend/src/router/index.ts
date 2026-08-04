import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useCapabilities } from '@/composables/useCapabilities';
import { isLocalTransportActive } from '@/api/client';
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
    // The local transport has no token-based auth lifecycle at all (#54's
    // remote credentials live in Rust secure storage, never the WebView) —
    // same reasoning `ensureFreshForRequest` (api/client.ts) and
    // `MainLayout`'s mount hook already apply. Without this, every
    // navigation would redirect to /login before MainLayout's own
    // isLocalMode-gated PairingGate ever got a chance to run, since there is
    // no login flow to complete under local transport. The admin-capability
    // gate below still applies either way.
    if (isLocalTransportActive()) {
        if (to.name === 'admin-users' && !useCapabilities().canUseAdmin) {
            return { path: '/' };
        }
        return true;
    }

    const auth = useAuthStore();

    // A server started with `auth.enabled = false` never bootstraps an admin
    // account and skips auth enforcement on every route server-side (see
    // librarium-server's AuthMiddleware) — so a login screen gated only on
    // "is there a valid token" would deadlock here too: no token can ever be
    // obtained. Bypass entirely, matching the server's own "no restrictions"
    // behavior in this mode, rather than trying to reproduce admin/capability
    // gating that doesn't map to "nobody is logged in."
    if (!(await auth.checkServerAuthEnabled())) {
        return true;
    }

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

        if (to.name === 'admin-users' && (!auth.isAdmin || !useCapabilities().canUseAdmin)) {
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
