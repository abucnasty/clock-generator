import { Close } from '@mui/icons-material';
import { Alert, Box, Button, IconButton, Portal, Snackbar } from '@mui/material';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { MessageActionsContext, MessageStateContext, useCurrentMessage, useDismissMessage } from '../hooks/useMessages';
import { messagesReducer, NO_MESSAGE, type MessageInput } from '../utils/messages';

/** Hidden from sight, read by screen readers */
const VISUALLY_HIDDEN = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    m: '-1px',
    p: 0,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
} as const;

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
    // the id of the message on screen, for isShown, which must not make its callers render again
    const shownId = useRef<number | null>(null);
    useEffect(() => {
        shownId.current = state.current?.id ?? null;
    }, [state]);
    const isShown = useCallback((id: number) => shownId.current === id, []);
    const actions = useMemo(() => ({ notify, dismiss, isShown }), [notify, dismiss, isShown]);

    return (
        <MessageActionsContext.Provider value={actions}>
            <MessageStateContext.Provider value={state.current}>
                {children}
            </MessageStateContext.Provider>
        </MessageActionsContext.Provider>
    );
}

/**
 * Draws the message shown, top centre just below the header, over the page, its footer and any dialog. Rendered once,
 * inside the theme; the portal keeps it out of any stacking context a parent makes. It is announced by its own role:
 * an alert for an error or a warning, a status otherwise.
 */
export function MessageHost() {
    const message = useCurrentMessage();
    const dismiss = useDismissMessage();
    if (!message) {
        return null;
    }
    const close = () => dismiss(message.id);
    const urgent = message.severity === 'error' || message.severity === 'warning';

    return (
        <Portal>
            <Snackbar
                key={message.id}
                open
                autoHideDuration={message.durationMs}
                // hovering or focusing it pauses the timer; leaving gives it its full time again, not MUI's half
                resumeHideDuration={message.durationMs ?? undefined}
                // a click elsewhere on the page does not close it: it goes after its time, with Escape or its close button
                onClose={(_, reason) => { if (reason !== 'clickaway') close(); }}
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
                    role={urgent ? 'alert' : 'status'}
                    elevation={6}
                    sx={{ width: '100%', alignItems: 'center' }}
                    onClose={message.action ? undefined : close}
                    action={message.action && (
                        <>
                            <Button
                                color="inherit"
                                size="small"
                                aria-keyshortcuts={message.action.keyShortcuts}
                                onClick={() => {
                                    message.action?.onClick();
                                    close();
                                }}
                            >
                                {message.action.label}
                            </Button>
                            <IconButton size="small" color="inherit" aria-label="Close" onClick={close}>
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
