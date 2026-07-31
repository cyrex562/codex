<template>
  <v-app-bar
    height="40"
    flat
    style="background: rgb(var(--v-theme-surface)); border-bottom: 1px solid rgb(var(--v-theme-border));"
  >
    <!-- Mobile: hamburger opens the overlay sidebar -->
    <v-btn
      v-if="isMobile"
      icon="mdi-menu"
      size="small"
      class="ml-1"
      title="Open sidebar"
      data-testid="topbar-menu-btn"
      @click="emit('toggle-sidebar')"
    />

    <v-app-bar-title class="text-caption font-weight-medium" style="color: rgb(var(--v-theme-on-background));">
      {{ vaultsStore.getActive()?.name ?? 'Librarium' }}
    </v-app-bar-title>

    <!-- Status chips: full text on desktop, icon-only on mobile -->
    <div class="d-flex align-center ga-2 mr-2">
      <v-chip size="x-small" :color="wsConnected ? 'success' : 'warning'" variant="tonal">
        <v-icon :start="!isMobile" :icon="wsConnected ? 'mdi-lan-connect' : 'mdi-lan-disconnect'" />
        <template v-if="!isMobile">{{ wsConnected ? 'Connected' : 'Offline' }}</template>
      </v-chip>
      <v-chip size="x-small" :color="dirtyCount > 0 ? 'warning' : 'success'" variant="tonal">
        <v-icon :start="!isMobile" :icon="dirtyCount > 0 ? 'mdi-content-save-alert-outline' : 'mdi-content-save-check-outline'" />
        <template v-if="!isMobile">{{ dirtyCount > 0 ? `${dirtyCount} unsaved` : 'Saved' }}</template>
      </v-chip>
      <SyncStatusChip v-if="isLocalMode" @click="openOfflineSync" />
    </div>

    <template #append>
      <v-btn
        icon="mdi-magnify"
        size="small"
        density="compact"
        title="Search (Ctrl+Shift+F)"
        data-testid="topbar-search-btn"
        :disabled="!hasActiveVault"
        @click="emit('open-search')"
      />
      <!-- Desktop-only quick buttons; on mobile these live in the account menu -->
      <template v-if="!isMobile">
        <v-btn
          v-if="canUsePlugins"
          icon="mdi-puzzle-outline"
          size="small"
          density="compact"
          title="Plugins"
          data-testid="topbar-plugins-btn"
          @click="emit('open-plugins')"
        />
        <v-btn
          icon="mdi-help-circle-outline"
          size="small"
          density="compact"
          title="Theme"
          data-testid="topbar-theme-btn"
          @click="toggleTheme"
        />
        <v-btn
          icon="mdi-cog"
          size="small"
          density="compact"
          title="Settings"
          data-testid="topbar-settings-btn"
          @click="openSettings"
        />
      </template>

      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            size="small"
            variant="text"
            :icon="isMobile ? 'mdi-account-circle-outline' : undefined"
            :prepend-icon="isMobile ? undefined : 'mdi-account-circle-outline'"
            data-testid="topbar-user-menu-btn"
          >
            <template v-if="!isMobile">{{ username }}</template>
            <v-icon v-else icon="mdi-account-circle-outline" />
          </v-btn>
        </template>

        <v-list density="compact" min-width="220">
          <template v-if="isMobile">
            <v-list-item
              v-if="canUsePlugins"
              prepend-icon="mdi-puzzle-outline"
              title="Plugins"
              data-testid="user-menu-plugins"
              @click="emit('open-plugins')"
            />
            <v-list-item
              prepend-icon="mdi-theme-light-dark"
              title="Toggle theme"
              data-testid="user-menu-theme"
              @click="toggleTheme"
            />
            <v-list-item
              prepend-icon="mdi-cog"
              title="Settings"
              data-testid="user-menu-settings"
              @click="openSettings"
            />
            <v-divider class="my-1" />
          </template>
          <v-list-item
            prepend-icon="mdi-lock-reset"
            title="Change password"
            data-testid="user-menu-change-password"
            @click="goToChangePassword"
          />
          <v-list-item
            v-if="authStore.isAdmin && canUseAdmin"
            prepend-icon="mdi-account-multiple-plus-outline"
            title="Manage users"
            data-testid="user-menu-manage-users"
            @click="goToAdminUsers"
          />
          <v-divider class="my-1" />
          <v-list-item
            prepend-icon="mdi-logout"
            title="Sign out"
            data-testid="user-menu-sign-out"
            @click="signOut"
          />
        </v-list>
      </v-menu>
    </template>
  </v-app-bar>

  <SettingsModal v-model="showSettings" :initial-tab="settingsInitialTab" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useVaultsStore } from '@/stores/vaults';
import { usePreferencesStore } from '@/stores/preferences';
import { useTabsStore } from '@/stores/tabs';
import { useAuthStore } from '@/stores/auth';
import { useWebSocket } from '@/composables/useWebSocket';
import { useMobile } from '@/composables/useMobile';
import { useCapabilities } from '@/composables/useCapabilities';
import SettingsModal from '@/components/settings/SettingsModal.vue';
import SyncStatusChip from '@/components/sync/SyncStatusChip.vue';

const emit = defineEmits<{
  'open-search': [];
  'open-plugins': [];
  'toggle-sidebar': [];
}>();

const vaultsStore = useVaultsStore();
const prefsStore = usePreferencesStore();
const tabsStore = useTabsStore();
const authStore = useAuthStore();
const router = useRouter();
const { connected, disconnect } = useWebSocket(false);
const { isMobile } = useMobile();
const { canUseAdmin, canUsePlugins, isLocalMode } = useCapabilities();

const dirtyCount = computed(() => tabsStore.dirtyTabs.length);
const wsConnected = computed(() => connected.value);
const username = computed(() => authStore.profile?.username ?? 'Account');
const hasActiveVault = computed(() => !!vaultsStore.activeVaultId);
const showSettings = ref(false);
const settingsInitialTab = ref<string | undefined>(undefined);

function openSettings() {
  settingsInitialTab.value = undefined;
  showSettings.value = true;
}

function openOfflineSync() {
  settingsInitialTab.value = 'offline-sync';
  showSettings.value = true;
}

function toggleTheme() {
  prefsStore.set('theme', prefsStore.prefs.theme === 'dark' ? 'light' : 'dark');
  prefsStore.save();
}

function goToChangePassword() {
  void router.push('/change-password');
}

function goToAdminUsers() {
  void router.push('/admin/users');
}

async function signOut() {
  disconnect();
  await authStore.logout();
  await router.replace('/login');
}
</script>
