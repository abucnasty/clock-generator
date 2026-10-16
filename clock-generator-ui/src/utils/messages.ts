export type MessageSeverity = 'success' | 'info' | 'warning' | 'error';

/** A button shown in the message, before its close button; the message closes after it is clicked */
export interface MessageAction {
    label: string;
    onClick: () => void;
    /** The keys that do the same, as `aria-keyshortcuts` gives them ("Control+Z Meta+Z") */
    keyShortcuts?: string;
}

export interface MessageInput {
    text: string;
    /** Info when left out */
    severity?: MessageSeverity;
    /** How long the message stays, by its severity when left out; null keeps it until it is closed */
    durationMs?: number | null;
    action?: MessageAction;
    /** Read out after the text, and not shown: what a screen reader user needs besides, such as a key to press */
    hint?: string;
    /** Show the message now, but let its owner announce it once an asynchronous outcome is known */
    deferAnnouncement?: boolean;
    /** Called once when the message goes, however it goes: closed, timed out, or replaced by another */
    onClose?: () => void;
    /** Where focus goes when the player closes the message, or uses its action, from inside it; none leaves it be */
    returnFocus?: () => HTMLElement | null;
}

export interface Message extends Omit<MessageInput, 'severity' | 'durationMs' | 'deferAnnouncement'> {
    id: number;
    severity: MessageSeverity;
    durationMs: number | null;
}

/** Text for the page's one polite live region; a new id writes it again, so the same text is read out twice */
export interface Announcement {
    id: number;
    text: string;
}

export interface MessageState {
    current: Message | null;
    announcement: Announcement | null;
}

type MessageEvent =
    | { type: 'notify'; id: number; message: MessageInput }
    | { type: 'dismiss'; id: number }
    | { type: 'announce'; id: number; text: string }
    | { type: 'announce-message'; id: number; messageId: number; suffix?: string };

export const NO_MESSAGE: MessageState = { current: null, announcement: null };

/** An error stays until the player closes it: it may need reading twice */
const DEFAULT_DURATION_MS: Record<MessageSeverity, number | null> = {
    success: 6000,
    info: 6000,
    warning: 10000,
    error: null,
};

/** Errors and warnings are drawn filled */
export const isUrgent = (severity: MessageSeverity) => severity === 'error' || severity === 'warning';

/**
 * One message at a time: a new one replaces the one shown, since the player should see the result of what they just
 * did. Closing a message that has already been replaced leaves the newer one open, and the state as it is. Every
 * message is also announced, with its hint, unless its owner defers that until an asynchronous outcome is known.
 */
export function messagesReducer(state: MessageState, event: MessageEvent): MessageState {
    switch (event.type) {
        case 'notify': {
            const { severity = 'info', durationMs, deferAnnouncement, ...rest } = event.message;
            return {
                current: {
                    ...rest,
                    id: event.id,
                    severity,
                    durationMs: durationMs !== undefined ? durationMs : DEFAULT_DURATION_MS[severity],
                },
                announcement: deferAnnouncement ? state.announcement : { id: event.id, text: [rest.text, rest.hint].filter(Boolean).join(' ') },
            };
        }
        case 'dismiss':
            return state.current?.id === event.id ? { ...state, current: null } : state;
        case 'announce':
            return { ...state, announcement: { id: event.id, text: event.text } };
        case 'announce-message': {
            // Closing/replacing the offer, or newer workflow news, makes this completion obsolete. A successful
            // completion has a newer id too, so the same callback cannot read the offer out twice.
            const message = state.current;
            if (message?.id !== event.messageId || (state.announcement?.id ?? 0) > event.messageId) return state;
            return { ...state, announcement: { id: event.id, text: [message.text, message.hint, event.suffix].filter(Boolean).join(' ') } };
        }
    }
}
