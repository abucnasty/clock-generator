import { createContext, useContext } from 'react';
import type { Message, MessageInput } from '../utils/messages';

interface MessageActions {
    /** Shows a message in place of the one shown, and returns its id */
    notify: (input: MessageInput) => number;
    /** Closes the message with this id, if it is still the one shown */
    dismiss: (id: number) => void;
}

/** Never changes, so that what only raises messages does not render again when one comes or goes */
export const MessageActionsContext = createContext<MessageActions>({
    notify: () => 0,
    dismiss: () => {},
});

export const MessageStateContext = createContext<Message | null>(null);

/** Shows a message to the player, below the header. Call it from an event handler or an effect, never while rendering */
export function useNotify(): (input: MessageInput) => number {
    return useContext(MessageActionsContext).notify;
}

export function useDismissMessage(): (id: number) => void {
    return useContext(MessageActionsContext).dismiss;
}

export function useCurrentMessage(): Message | null {
    return useContext(MessageStateContext);
}
