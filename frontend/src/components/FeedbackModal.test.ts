import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils';
import { vuetify } from '@/plugins/vuetify';

vi.mock('@/composables/useFeedback', () => ({
    buildFeedbackZip: vi.fn(),
    saveFeedbackZip: vi.fn(),
}));

import { buildFeedbackZip, saveFeedbackZip } from '@/composables/useFeedback';
import FeedbackModal from './FeedbackModal.vue';

let mounted: ReturnType<typeof mount> | null = null;

// `v-dialog` teleports its content to `document.body`, outside the mounted
// wrapper's own root — query/interact via `document` instead of `wrapper.find`.
function byTestId(id: string): DOMWrapper<Element> {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) throw new Error(`not found: [data-testid="${id}"]`);
    return new DOMWrapper(el);
}

function mountModal(screenshot: Blob | null = null) {
    const wrapper = mount(FeedbackModal, {
        props: { modelValue: true, screenshot },
        global: { plugins: [vuetify] },
    });
    mounted = wrapper;
    return wrapper;
}

describe('FeedbackModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        URL.createObjectURL = vi.fn(() => 'blob:fake-url');
        URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        // `v-dialog` teleports into `document.body`, which outlives the
        // wrapper unless explicitly unmounted — leaks across tests otherwise.
        mounted?.unmount();
        mounted = null;
    });

    it('disables submit until a message is entered', async () => {
        mountModal();
        await flushPromises();

        expect(byTestId('feedback-submit-btn').attributes('disabled')).not.toBeUndefined();

        await byTestId('feedback-message-input').find('textarea').setValue('it broke');
        await flushPromises();

        expect(byTestId('feedback-submit-btn').attributes('disabled')).toBeUndefined();
    });

    it('builds and saves a zip with the entered message on submit', async () => {
        const fakeZip = new Blob(['zip-bytes']);
        vi.mocked(buildFeedbackZip).mockResolvedValue(fakeZip);
        vi.mocked(saveFeedbackZip).mockResolvedValue({ saved: true, path: '/tmp/feedback.zip' });

        mountModal();
        await byTestId('feedback-message-input').find('textarea').setValue('it broke');
        await flushPromises();

        await byTestId('feedback-submit-btn').trigger('click');
        await flushPromises();

        expect(buildFeedbackZip).toHaveBeenCalledWith('it broke', null);
        expect(saveFeedbackZip).toHaveBeenCalledWith(fakeZip);
        expect(document.body.textContent).toContain('/tmp/feedback.zip');
    });

    it('omits the screenshot from the bundle when the checkbox is unchecked', async () => {
        const shot = new Blob(['png']);
        vi.mocked(buildFeedbackZip).mockResolvedValue(new Blob(['zip']));
        vi.mocked(saveFeedbackZip).mockResolvedValue({ saved: true });

        mountModal(shot);
        await byTestId('feedback-message-input').find('textarea').setValue('it broke');
        await byTestId('feedback-include-screenshot').find('input').setValue(false);
        await flushPromises();

        await byTestId('feedback-submit-btn').trigger('click');
        await flushPromises();

        expect(buildFeedbackZip).toHaveBeenCalledWith('it broke', null);
    });

    it('shows an error message when saving fails', async () => {
        vi.mocked(buildFeedbackZip).mockRejectedValue(new Error('disk full'));

        mountModal();
        await byTestId('feedback-message-input').find('textarea').setValue('it broke');
        await flushPromises();

        await byTestId('feedback-submit-btn').trigger('click');
        await flushPromises();

        expect(document.body.textContent).toContain('disk full');
    });

    it('resets its fields after closing', async () => {
        const wrapper = mountModal();
        await byTestId('feedback-message-input').find('textarea').setValue('draft text');
        await flushPromises();

        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();

        const textarea = byTestId('feedback-message-input').find('textarea').element as HTMLTextAreaElement;
        expect(textarea.value).toBe('');
    });
});
