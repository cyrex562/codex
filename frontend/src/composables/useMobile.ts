import { computed } from 'vue';
import { useDisplay } from 'vuetify';

/**
 * Single source of truth for "is this a mobile-sized viewport?".
 *
 * Mobile = Vuetify's `smAndDown` (viewport < 960px): phones and small/portrait
 * tablets. At this size the app switches to a single-pane, overlay-drawer
 * layout with touch-friendly spacing.
 *
 * Purely width-based (reactive to resize/rotation) so desktop users who
 * narrow their window get the same adaptive behavior. Touch-specific CSS
 * (larger hit targets) is handled separately via `@media (pointer: coarse)`.
 */
export function useMobile() {
  const display = useDisplay();
  const isMobile = computed(() => display.smAndDown.value);
  return { isMobile };
}
