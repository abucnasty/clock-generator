import { describe, expect, it } from 'vitest';
import { messagesReducer, NO_MESSAGE, type MessageInput, type MessageState } from './messages';

const notify = (state: MessageState, id: number, message: MessageInput) =>
    messagesReducer(state, { type: 'notify', id, message });

describe('messagesReducer', () => {
    it('shows a notified message with its text and id, as info when no severity is given', () => {
        const state = notify(NO_MESSAGE, 1, { text: 'Hello' });
        expect(state.current).toEqual({ id: 1, text: 'Hello', severity: 'info', durationMs: 6000, action: undefined });
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

    it('keeps the action as given', () => {
        const action = { label: 'Undo', onClick: () => {} };
        const state = notify(NO_MESSAGE, 1, { text: 'x', action });
        expect(state.current?.action).toBe(action);
        expect(state.current?.action?.onClick).toBe(action.onClick);
    });

    it('replaces the message shown with a newer one, even one with the same text', () => {
        const first = notify(NO_MESSAGE, 1, { text: 'Configuration exported successfully!', severity: 'success' });
        const second = notify(first, 2, { text: 'Failed to paste: no', severity: 'error' });
        expect(second.current?.id).toBe(2);
        expect(second.current?.text).toBe('Failed to paste: no');
        const again = notify(first, 3, { text: 'Configuration exported successfully!', severity: 'success' });
        expect(again.current?.id).toBe(3);
        expect(again.current).not.toBe(first.current);
    });

    it('closes the message shown when it is dismissed', () => {
        const state = notify(NO_MESSAGE, 1, { text: 'x' });
        expect(messagesReducer(state, { type: 'dismiss', id: 1 })).toBe(NO_MESSAGE);
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
