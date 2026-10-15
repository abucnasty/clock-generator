import { Close } from '@mui/icons-material';
import { Alert, Box, Button, IconButton, Portal, Snackbar } from '@mui/material';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { MessageActionsContext, MessageStateContext, useDismissMessage, useMessageState } from '../hooks/useMessages';
import { ANNOUNCER_ATTRIBUTE, announceText } from '../utils/announcer';
import { isUrgent, messagesReducer, NO_MESSAGE, type Message, type MessageInput } from '../utils/messages';
import { isEscapeForSomethingElse } from '../utils/undoKeys';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { CONTROL, SURFACE } from '../theme/tokens';

/** Holds the one message shown, for any component to raise with `useNotify()`; goes above `App`, which raises some */
export function MessageProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(messagesReducer, NO_MESSAGE);
    const nextId = useRef(0);
    const notify = useCallback((input: MessageInput) => {
        const id = ++nextId.current;
        dispatch({ type: 'notify', id, message: input });
        return id;
    }, []);
    const dismiss = useCallback((id: number) => dispatch({ type: 'dismiss', id }), []);
    const announce = useCallback((text: string) => dispatch({ type: 'announce', id: ++nextId.current, text }), []);
    const actions = useMemo(() => ({ notify, dismiss, announce }), [notify, dismiss, announce]);

    // a message that goes, however it goes (closed, timed out, replaced), is told so once
    const shown = useRef<Message | null>(null);
    useEffect(() => {
        const previous = shown.current;
        shown.current = state.current;
        if (previous && previous !== state.current) {
            previous.onClose?.();
        }
    }, [state]);

    return (
        <MessageActionsContext.Provider value={actions}>
            <MessageStateContext.Provider value={state}>
                {children}
            </MessageStateContext.Provider>
        </MessageActionsContext.Provider>
    );
}

/**
 * The page's polite live region, always there and empty until something is announced, and the message shown, top
 * centre just below the header, over the page, its footer and any dialog. Rendered once, inside the theme. An error or
 * a warning is announced by its own alert role; any other message, and `announce` text, by the live region, so it is
 * read out once. While a dialog hides the app from screen readers, `announceText` uses a region on `<body>` instead.
 */
export function MessageHost() {
    const { current, announcement } = useMessageState();
    const dismiss = useDismissMessage();
    const regionRef = useRef<HTMLDivElement>(null);
    // written outside React: where it goes depends on the page at the moment it is written
    useEffect(() => {
        if (announcement) {
            announceText(regionRef.current, announcement.text);
        }
    }, [announcement]);
    return (
        <>
            <Box ref={regionRef} role="status" sx={VISUALLY_HIDDEN} {...{ [ANNOUNCER_ATTRIBUTE]: '' }} />
            {current && <MessageSnackbar key={current.id} message={current} onDismiss={dismiss} />}
        </>
    );
}

function MessageSnackbar({ message, onDismiss }: { message: Message; onDismiss: (id: number) => void }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const urgent = isUrgent(message.severity);

    /** Closes it, after `run`; from inside it, focus moves where the message says instead of falling to the page's top */
    const leave = (run?: () => void) => {
        const focusWasInside = rootRef.current?.contains(document.activeElement) ?? false;
        run?.();
        onDismiss(message.id);
        const { returnFocus } = message;
        if (focusWasInside && returnFocus) {
            // once what `run` changed is drawn
            setTimeout(() => returnFocus()?.focus(), 0);
        }
    };

    // the portal keeps it out of any stacking context a parent makes
    return (
        <Portal>
            <Snackbar
                ref={rootRef}
                // for whoever needs to tell focus in the message from focus on the page
                data-message=""
                open
                autoHideDuration={message.durationMs}
                // hovering or focusing it pauses the timer; leaving gives it its full time again, not MUI's half
                resumeHideDuration={message.durationMs ?? undefined}
                onClose={(event, reason) => {
                    // a click elsewhere on the page does not close it, nor an Escape that closes a list, menu or dialog
                    if (reason === 'clickaway') return;
                    if (reason === 'escapeKeyDown' && isEscapeForSomethingElse(event as Event, document.activeElement)) return;
                    leave();
                }}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                sx={{
                    top: { xs: 'calc(var(--app-header-height, 64px) + 8px)', sm: 'calc(var(--app-header-height, 64px) + 8px)' },
                    width: { sm: 'max-content' },
                    maxWidth: { sm: 'min(640px, calc(100vw - 16px))' },
                }}
            >
                <Alert
                    severity={message.severity}
                    variant={urgent ? 'filled' : 'standard'}
                    // the live region reads out the rest; a status mounted with its text is often not read out
                    role={urgent ? 'alert' : 'none'}
                    elevation={6}
                    // an urgent one is filled in its colour; the others are a card with an edge, the severity in the icon,
                    // and the action (Undo) in the accent orange, as a text action on a card is
                    sx={{
                        width: '100%',
                        alignItems: 'center',
                        ...(!urgent && { bgcolor: SURFACE.panel, color: 'text.primary', border: `1px solid ${CONTROL.edge}` }),
                    }}
                    onClose={message.action ? undefined : () => leave()}
                    action={message.action && (
                        <>
                            <Button
                                color={urgent ? 'inherit' : 'primary'}
                                size="small"
                                aria-keyshortcuts={message.action.keyShortcuts}
                                onClick={() => leave(message.action?.onClick)}
                            >
                                {message.action.label}
                            </Button>
                            <IconButton size="small" color="inherit" aria-label="Close" onClick={() => leave()}>
                                <Close fontSize="small" />
                            </IconButton>
                        </>
                    )}
                >
                    {message.text}
                    {message.hint && <Box component="span" sx={VISUALLY_HIDDEN}> {message.hint}</Box>}
                </Alert>
            </Snackbar>
        </Portal>
    );
}
