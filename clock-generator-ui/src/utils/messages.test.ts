import { describe, expect, it } from 'vitest';
import { messagesReducer, NO_MESSAGE, type MessageInput, type MessageState } from './messages';

const notify = (state: MessageState, id: number, message: MessageInput) =>
    messagesReducer(state, { type: 'notify', id, message });

describe('messagesReducer', () => {
    it('shows a notified message with its text and id, as info when no severity is given', () => {
        const state = notify(NO_MESSAGE, 1, { text: 'Hello' });
        expect(state.current).toEqual({ id: 1, text: 'Hello', severity: 'info', durationMs: 6000 });
    });

    it.each([
        ['success', 6000],
        ['info', 6000],
        ['warning', 10000],
        ['error', null],
    ] as const)('keeps a %s message for %s ms by default', (severity, durationMs) => {
        expect(notify(NO_MESSAGE, 1, { text: 'x', severity }).current?.durationMs).toBe(durationMs);
    });

    it('takes a duration given with the message over the default, including none at all', () => {
        const withAction = notify(NO_MESSAGE, 1, { text: 'x', durationMs: 10000, action: { label: 'Undo', onClick: () => {} } });
        expect(withAction.current?.durationMs).toBe(10000);
        expect(notify(NO_MESSAGE, 2, { text: 'x', severity: 'success', durationMs: null }).current?.durationMs).toBeNull();
    });

    it('keeps the action and the callbacks as given', () => {
        const action = { label: 'Undo', onClick: () => {} };
        const onClose = () => {};
        const returnFocus = () => null;
        const state = notify(NO_MESSAGE, 1, { text: 'x', action, onClose, returnFocus });
        expect(state.current?.action).toBe(action);
        expect(state.current?.onClose).toBe(onClose);
        expect(state.current?.returnFocus).toBe(returnFocus);
    });

    it('replaces the message shown with a newer one, even one with the same text', () => {
        const first = notify(NO_MESSAGE, 1, { text: 'Build exported.', severity: 'success' });
        const second = notify(first, 2, { text: 'Failed to paste: no', severity: 'error' });
        expect(second.current?.id).toBe(2);
        expect(second.current?.text).toBe('Failed to paste: no');
        const again = notify(first, 3, { text: 'Build exported.', severity: 'success' });
        expect(again.current?.id).toBe(3);
        expect(again.current).not.toBe(first.current);
    });

    it('closes the message shown when it is dismissed', () => {
        const state = notify(NO_MESSAGE, 1, { text: 'x' });
        expect(messagesReducer(state, { type: 'dismiss', id: 1 }).current).toBeNull();
    });

    it('leaves a newer message open, and the state as it is, when an older one is dismissed', () => {
        const state = notify(notify(NO_MESSAGE, 1, { text: 'old' }), 2, { text: 'new' });
        const after = messagesReducer(state, { type: 'dismiss', id: 1 });
        expect(after).toBe(state);
        expect(after.current?.text).toBe('new');
    });

    it('leaves an empty state as it is when dismissed', () => {
        expect(messagesReducer(NO_MESSAGE, { type: 'dismiss', id: 4 })).toBe(NO_MESSAGE);
    });
});

describe('the live region', () => {
    it('announces a success or info message with its hint, under the message\'s id', () => {
        expect(notify(NO_MESSAGE, 1, { text: 'Build exported.', severity: 'success' }).announcement)
            .toEqual({ id: 1, text: 'Build exported.' });
        expect(notify(NO_MESSAGE, 2, { text: 'Build reset.', hint: 'Or press Ctrl+Z to undo.' }).announcement)
            .toEqual({ id: 2, text: 'Build reset. Or press Ctrl+Z to undo.' });
    });

    it('leaves errors and warnings to their own alert role', () => {
        const before = notify(NO_MESSAGE, 1, { text: 'Build exported.', severity: 'success' });
        expect(notify(before, 2, { text: 'Failed to paste: no', severity: 'error' }).announcement).toBe(before.announcement);
        expect(notify(before, 3, { text: 'Copied. Slow.', severity: 'warning' }).announcement).toBe(before.announcement);
    });

    it('announces text that shows no message, a new id each time so that the same text is read out again', () => {
        const once = messagesReducer(NO_MESSAGE, { type: 'announce', id: 1, text: 'Generating clocks' });
        const twice = messagesReducer(once, { type: 'announce', id: 2, text: 'Generating clocks' });
        expect(once).toEqual({ current: null, announcement: { id: 1, text: 'Generating clocks' } });
        expect(twice.announcement).toEqual({ id: 2, text: 'Generating clocks' });
    });

    it('keeps the message shown when text is announced, and the announcement when the message goes', () => {
        const shown = notify(NO_MESSAGE, 1, { text: 'Failed to import: x', severity: 'error' });
        const announced = messagesReducer(shown, { type: 'announce', id: 2, text: 'Blueprint copied' });
        expect(announced.current).toBe(shown.current);
        expect(messagesReducer(announced, { type: 'dismiss', id: 1 }).announcement).toBe(announced.announcement);
    });
});
