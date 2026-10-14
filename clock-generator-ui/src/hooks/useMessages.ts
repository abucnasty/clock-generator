import { createContext, useContext } from 'react';
import { NO_MESSAGE, type MessageInput, type MessageState } from '../utils/messages';

interface MessageActions {
    /** Shows a message in place of the one shown, and returns its id */
    notify: (input: MessageInput) => number;
    /** Closes the message with this id, if it is still the one shown */
    dismiss: (id: number) => void;
    /**
     * Reads text out in the page's one polite live region, the messages', without showing anything: for news shown
     * elsewhere on the page, such as "Generating clocks". The same text twice is read out twice.
     */
    announce: (text: string) => void;
}

/** Never changes, so that what only raises messages does not render again when one comes or goes */
export const MessageActionsContext = createContext<MessageActions>({
    notify: () => 0,
    dismiss: () => {},
    announce: () => {},
});

export const MessageStateContext = createContext<MessageState>(NO_MESSAGE);

/** Shows a message to the player, below the header. Call it from an event handler or an effect, never while rendering */
export function useNotify(): (input: MessageInput) => number {
    return useContext(MessageActionsContext).notify;
}

export function useDismissMessage(): (id: number) => void {
    return useContext(MessageActionsContext).dismiss;
}

export function useMessageState(): MessageState {
    return useContext(MessageStateContext);
}
