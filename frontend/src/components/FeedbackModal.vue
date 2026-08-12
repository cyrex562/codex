<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    :fullscreen="isMobile"
    @update:model-value="onDialogUpdate"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        Send feedback
        <v-spacer />
        <v-btn icon="mdi-close" size="small" variant="plain" data-testid="feedback-modal-close-btn" @click="close" />
      </v-card-title>

      <v-card-text>
        <p class="text-caption text-medium-emphasis mb-3">
          Describe the issue. A snapshot of your current view (open notes, recent
          logs, app version) is bundled alongside it as a zip file — nothing is
          sent anywhere; you choose where it's saved. Nothing beyond what's shown
          below leaves the app.
        </p>

        <v-textarea
          v-model="message"
          label="What happened?"
          auto-grow
          rows="4"
          data-testid="feedback-message-input"
        />

        <v-checkbox
          v-if="screenshotUrl"
          v-model="includeScreenshot"
          label="Include a screenshot of the app"
          density="compact"
          hide-details
          data-testid="feedback-include-screenshot"
        />
        <img
          v-if="screenshotUrl && includeScreenshot"
          :src="screenshotUrl"
          alt="Screenshot preview"
          style="width: 100%; border: 1px solid rgb(var(--v-theme-border)); border-radius: 4px; margin-top: 8px;"
        />

        <v-alert v-if="resultMessage" type="success" density="compact" class="mt-3" data-testid="feedback-result">
          {{ resultMessage }}
        </v-alert>
        <v-alert v-if="errorMessage" type="error" density="compact" class="mt-3" data-testid="feedback-error">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn
          color="primary"
          :loading="submitting"
          :disabled="!message.trim()"
          data-testid="feedback-submit-btn"
          @click="submit"
        >
          Save feedback bundle
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useMobile } from '@/composables/useMobile';
import { buildFeedbackZip, saveFeedbackZip } from '@/composables/useFeedback';

const props = defineProps<{ modelValue: boolean; screenshot: Blob | null }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const { isMobile } = useMobile();

const message = ref('');
const includeScreenshot = ref(true);
const submitting = ref(false);
const resultMessage = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const screenshotUrl = ref<string | null>(null);

watch(
  () => props.screenshot,
  (blob) => {
    if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value);
    screenshotUrl.value = blob ? URL.createObjectURL(blob) : null;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value);
});

function reset() {
  message.value = '';
  includeScreenshot.value = true;
  resultMessage.value = null;
  errorMessage.value = null;
}

// Covers both the dialog's own close interactions (Escape, click-outside —
// emitted via update:model-value) and the parent closing it by changing the
// modelValue prop directly (e.g. the TopBar's close/cancel wiring), so the
// form is always blank the next time it opens either way.
watch(
  () => props.modelValue,
  (value) => {
    if (!value) reset();
  },
);

function onDialogUpdate(value: boolean) {
  emit('update:modelValue', value);
}

function close() {
  onDialogUpdate(false);
}

async function submit() {
  submitting.value = true;
  resultMessage.value = null;
  errorMessage.value = null;
  try {
    const shot = includeScreenshot.value ? props.screenshot : null;
    const zip = await buildFeedbackZip(message.value, shot);
    const result = await saveFeedbackZip(zip);
    if (result.saved) {
      resultMessage.value = result.path
        ? `Saved to ${result.path}`
        : 'Downloaded — check your browser downloads.';
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to save feedback bundle.';
  } finally {
    submitting.value = false;
  }
}
</script>
