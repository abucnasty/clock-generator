import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canDeliverAnnouncement, messagesReducer, NO_MESSAGE, type MessageInput, type MessageState } from './messages';
import { announceText } from './announcer';

const notify = (state: MessageState, id: number, message: MessageInput) =>
    messagesReducer(state, { type: 'notify', id, message });

/** A shared build opened while its kept clocks load: Undo is offered at once, the announcement waits for the clocks */
const SHARED: MessageInput = {
    text: 'Shared build opened: Science.',
    hint: 'Or press Cmd+Z to undo.',
    action: { label: 'Undo', onClick: () => {} },
    durationMs: null,
    deferAnnouncement: true,
};
/** The opening, its shortcut and the restored clocks, read out together */
const SHARED_SPOKEN = 'Shared build opened: Science. Or press Cmd+Z to undo. Its clocks are back.';
/** The clocks of message 1 are back */
const complete = (state: MessageState, id = 2) => messagesReducer(state, {
    type: 'announce-message', id, messageId: 1, suffix: 'Its clocks are back.',
});

describe('messagesReducer', () => {
    it('shows a notified message with its text and id, as info when no severity is given', () => {
        expect(notify(NO_MESSAGE, 1, { text: 'Hello' }).current).toEqual({ id: 1, text: 'Hello', severity: 'info', durationMs: 6000 });
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
        expect(notify(NO_MESSAGE, 1, { text: 'x', durationMs: 10000, action: { label: 'Undo', onClick: () => {} } }).current?.durationMs).toBe(10000);
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
        expect(notify(first, 2, { text: 'Failed to paste: no', severity: 'error' }).current).toMatchObject({ id: 2, text: 'Failed to paste: no' });
        const again = notify(first, 3, { text: 'Build exported.', severity: 'success' });
        expect(again.current?.id).toBe(3);
        expect(again.current).not.toBe(first.current);
    });

    it('closes the message shown when it is dismissed', () => {
        expect(messagesReducer(notify(NO_MESSAGE, 1, { text: 'x' }), { type: 'dismiss', id: 1 }).current).toBeNull();
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
    const exported = notify(NO_MESSAGE, 1, { text: 'Build exported.', severity: 'success' });

    // errors and warnings are announced the same way, over what was announced before
    it.each<[string, MessageState, MessageInput, string]>([
        ['a success message', NO_MESSAGE, { text: 'Build exported.', severity: 'success' }, 'Build exported.'],
        ['an info message with its hint', NO_MESSAGE, { text: 'Build reset.', hint: 'Or press Ctrl+Z to undo.' }, 'Build reset. Or press Ctrl+Z to undo.'],
        ['an error', exported, { text: 'Failed to paste: no', severity: 'error' }, 'Failed to paste: no'],
        ['a warning with its hint', exported, { text: 'Copied. Slow.', severity: 'warning', hint: 'Check the rate.' }, 'Copied. Slow. Check the rate.'],
    ])('announces %s under the message\'s id', (_, before, message, text) => {
        expect(notify(before, 2, message).announcement).toEqual({ id: 2, text });
    });

    it('announces the same message raised twice under two ids, so that it is read out twice', () => {
        const once = notify(NO_MESSAGE, 1, { text: 'Failed to paste: no', severity: 'error' });
        const twice = notify(once, 2, { text: 'Failed to paste: no', severity: 'error' });
        expect(once.announcement?.id).not.toBe(twice.announcement?.id);
        expect(twice.announcement?.text).toBe(once.announcement?.text);
    });

    it('announces text that shows no message, a new id each time so that the same text is read out again', () => {
        const once = messagesReducer(NO_MESSAGE, { type: 'announce', id: 1, text: 'Generating clocks' });
        expect(once).toEqual({ current: null, announcement: { id: 1, text: 'Generating clocks' } });
        expect(messagesReducer(once, { type: 'announce', id: 2, text: 'Generating clocks' }).announcement).toEqual({ id: 2, text: 'Generating clocks' });
    });

    it('keeps the message shown when text is announced, and the announcement when the message goes', () => {
        const shown = notify(NO_MESSAGE, 1, { text: 'Failed to import: x', severity: 'error' });
        const announced = messagesReducer(shown, { type: 'announce', id: 2, text: 'Blueprint copied' });
        expect(announced.current).toBe(shown.current);
        expect(messagesReducer(announced, { type: 'dismiss', id: 1 }).announcement).toBe(announced.announcement);
    });
});

describe('a shared build waiting for its kept clocks', () => {
    const waiting = notify(NO_MESSAGE, 1, SHARED);

    it('offers Undo immediately, then announces the opening, shortcut and restored clocks together once', () => {
        expect(waiting.current).toMatchObject({ text: SHARED.text, action: SHARED.action, durationMs: null });
        expect(waiting.announcement).toBeNull();
        const completed = complete(waiting);
        expect(completed.current).toBe(waiting.current);
        expect(completed.announcement?.text).toBe(SHARED_SPOKEN);
        expect(complete(completed, 3)).toBe(completed);
    });

    it('does not interrupt a newer workflow action with an obsolete completion', () => {
        const checking = messagesReducer(waiting, { type: 'announce', id: 2, text: 'Checking the build.' });
        // The offer may still be drawn while the Check action's withdrawal is being applied.
        expect(checking.current).toBe(waiting.current);
        expect(complete(checking, 3)).toBe(checking);
    });

    it('does not announce an offer that was closed or replaced while its clocks were loading', () => {
        const closed = messagesReducer(waiting, { type: 'dismiss', id: 1 });
        expect(complete(closed)).toBe(closed);
        const newer = notify(waiting, 2, { text: 'Build reset.' });
        expect(complete(newer, 3)).toBe(newer);
    });
});

describe('owned speech waiting for a dialog to close', () => {
    // Only the DOM operations used by the real announcer; no simulated timer or delivery implementation.
    class Region {
        isConnected = true;
        hidden = false;
        textContent = '';
        style = { cssText: '' };
        closest() { return this.hidden ? this : null; }
        setAttribute() {}
        replaceChildren(...nodes: Region[]) { this.textContent = nodes.map(node => node.textContent).join(''); }
        remove() { this.isConnected = false; }
    }
    let main: Region, nodes: Region[], appended: Region[];
    beforeEach(() => {
        vi.useFakeTimers();
        nodes = []; appended = []; main = new Region(); main.hidden = true;
        vi.stubGlobal('document', {
            createElement: () => { const node = new Region(); nodes.push(node); return node; },
            body: { append: (node: Region) => appended.push(node) },
        });
    });
    afterEach(() => {
        nodes.forEach(node => node.remove());
        vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
    });
    /** Queues the completed share in an empty spare, rechecked at delivery against `committed.current` */
    const queue = () => {
        const committed = { current: complete(notify(NO_MESSAGE, 1, SHARED)) };
        const announcement = committed.current.announcement!;
        announceText(main as unknown as HTMLElement, announcement.text, () => canDeliverAnnouncement(committed.current, announcement));
        expect(appended).toHaveLength(1);
        expect(appended[0]).toMatchObject({ hidden: false, textContent: '' });
        return committed;
    };

    it('does not write queued shared success when Undo dismisses its offer before delivery', () => {
        const committed = queue();
        vi.advanceTimersByTime(99);
        // The closing dialog releases the page; accepted Undo dismisses the offer without newer speech.
        main.hidden = false;
        committed.current = messagesReducer(committed.current, { type: 'dismiss', id: 1 });
        vi.advanceTimersByTime(1);
        expect(appended[0].textContent).toBe('');
        expect(main.textContent).toBe('');
    });

    it('reroutes still-current speech when a newly opened menu hides the queued spare', () => {
        queue();
        const [hiddenSpare] = appended;
        hiddenSpare.hidden = true;
        vi.advanceTimersByTime(100);
        expect(hiddenSpare.textContent).toBe('');
        expect(appended).toHaveLength(2);
        const replacement = appended[1];
        expect(replacement).toMatchObject({ hidden: false, isConnected: true, textContent: '' });
        vi.advanceTimersByTime(100);
        expect(hiddenSpare.textContent).toBe('');
        expect(replacement.textContent).toBe(SHARED_SPOKEN);
        expect(main.textContent).toBe('');
    });

    it('writes the composed success to the exposed spare when its offer is still current at delivery', () => {
        queue();
        vi.advanceTimersByTime(100);
        expect(appended[0].textContent).toBe(SHARED_SPOKEN);
        expect(main.textContent).toBe('');
    });
});
