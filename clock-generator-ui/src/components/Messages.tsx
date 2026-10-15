import { Close } from '@mui/icons-material';
import { Alert, Box, Button, IconButton, Snackbar } from '@mui/material';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { MessageActionsContext, MessageStateContext, useDismissMessage, useMessageState } from '../hooks/useMessages';
import { ANNOUNCER_ATTRIBUTE, announceText } from '../utils/announcer';
import { isUrgent, messagesReducer, NO_MESSAGE, type Message, type MessageInput } from '../utils/messages';
import { entersOtherDialog, isEscapeForSomethingElse } from '../utils/undoKeys';
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
 * The page's polite live region, always there and empty until something is announced: every message is read out
 * through it once, when it is raised, as `announce` text is. Rendered once, inside the theme. While a dialog hides the
 * app from screen readers, `announceText` uses a region on `<body>` instead. The message itself is drawn by
 * `MessageSlot`. A message without an action closes when a dialog other than the fullscreen diagram opens; one with
 * Undo stays, behind the dialog, until the dialog closes.
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

    // read by the listener, so that it is added once
    const currentRef = useRef(current);
    useEffect(() => {
        currentRef.current = current;
    }, [current]);
    useEffect(() => {
        const onFocusIn = (event: FocusEvent) => {
            const shown = currentRef.current;
            const target = event.target instanceof Element ? event.target : null;
            if (shown && !shown.action && entersOtherDialog(target, event.relatedTarget)) {
                dismiss(shown.id);
            }
        };
        document.addEventListener('focusin', onFocusIn);
        return () => document.removeEventListener('focusin', onFocusIn);
    }, [dismiss]);

    return <Box ref={regionRef} role="status" sx={VISUALLY_HIDDEN} {...{ [ANNOUNCER_ATTRIBUTE]: '' }} />;
}

/**
 * Where the message is drawn, in the page's flow: the header, or the fullscreen diagram's title bar. Exactly one slot
 * is active at a time.
 */
export function MessageSlot({ active, inBar = false }: { active: boolean; inBar?: boolean }) {
    const { current } = useMessageState();
    const dismiss = useDismissMessage();
    if (!active || !current) {
        return null;
    }
    return (
        <Box
            sx={inBar
                // its own row under the title and Exit when narrow; between them from sm
                ? { order: { xs: 3, sm: 0 }, flexBasis: { xs: '100%', sm: 'auto' }, minWidth: 0, mr: { sm: 1 } }
                // the padding of the workflow bar's own rows
                : { px: { xs: 2, sm: 3 }, pb: 1 }}
        >
            <MessageSnackbar key={current.id} message={current} onDismiss={dismiss} />
        </Box>
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

    return (
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
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            // in the page's flow instead of over it: MUI's root is fixed at every width
            sx={{ position: 'static', justifyContent: 'flex-start', minWidth: 0 }}
        >
            <Alert
                severity={message.severity}
                variant={urgent ? 'filled' : 'standard'}
                // read out through the polite region, once, when it is raised
                role="none"
                elevation={0}
                // compact: one line is 32px, lower than the fullscreen diagram's title bar row, so it adds no height there.
                // An urgent one is filled in its colour; the others are a card with an edge (1px each side, taken off the
                // padding, so still 32px), the severity in the icon, and the action (Undo) in the accent orange
                sx={(theme) => ({
                    alignItems: 'center',
                    maxWidth: '100%',
                    py: 0,
                    '& .MuiAlert-icon, & .MuiAlert-message': { py: urgent ? '5px' : '4px' },
                    '& .MuiAlert-action': { pt: 0 },
                    ...(!urgent && { bgcolor: SURFACE.panel, color: 'text.primary', border: `1px solid ${CONTROL.edge}` }),
                    // below 600px an action's button gets a row of its own under the text, which would otherwise be
                    // squeezed into a column a word wide
                    ...(message.action && {
                        [theme.breakpoints.down('sm')]: {
                            flexWrap: 'wrap',
                            '& .MuiAlert-message': { flex: '1 1 0', minWidth: 0 },
                            '& .MuiAlert-action': { flexBasis: '100%', justifyContent: 'flex-end', ml: 0, pl: 0, pb: '4px' },
                        },
                    }),
                })}
                onClose={message.action ? undefined : () => leave()}
                action={message.action && (
                    <>
                        <Button
                            color={urgent ? 'inherit' : 'primary'}
                            size="small"
                            aria-keyshortcuts={message.action.keyShortcuts}
                            // one line: the text beside it wraps instead
                            sx={{ whiteSpace: 'nowrap' }}
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
    );
}
