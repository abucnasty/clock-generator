export type MessageSeverity = 'success' | 'info' | 'warning' | 'error';

/** A button shown in the message, before its close button; the message closes after it is clicked */
export interface MessageAction {
    label: string;
    onClick: () => void;
}

export interface MessageInput {
    text: string;
    /** Info when left out */
    severity?: MessageSeverity;
    /** How long the message stays, by its severity when left out; null keeps it until it is closed */
    durationMs?: number | null;
    action?: MessageAction;
}

export interface Message {
    id: number;
    text: string;
    severity: MessageSeverity;
    durationMs: number | null;
    action?: MessageAction;
}

export interface MessageState {
    current: Message | null;
}

type MessageEvent = { type: 'notify'; id: number; message: MessageInput } | { type: 'dismiss'; id: number };

export const NO_MESSAGE: MessageState = { current: null };

/** An error stays until the player closes it: it may need reading twice */
const DEFAULT_DURATION_MS: Record<MessageSeverity, number | null> = {
    success: 6000,
    info: 6000,
    warning: 10000,
    error: null,
};

/**
 * One message at a time: a new one replaces the one shown, since the player should see the result of what they just
 * did. Closing a message that has already been replaced leaves the newer one open, and the state as it is.
 */
export function messagesReducer(state: MessageState, event: MessageEvent): MessageState {
    switch (event.type) {
        case 'notify': {
            const severity = event.message.severity ?? 'info';
            return {
                current: {
                    id: event.id,
                    text: event.message.text,
                    severity,
                    durationMs: event.message.durationMs !== undefined ? event.message.durationMs : DEFAULT_DURATION_MS[severity],
                    action: event.message.action,
                },
            };
        }
        case 'dismiss':
            return state.current?.id === event.id ? NO_MESSAGE : state;
    }
}
