import { Close } from '@mui/icons-material';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, type DialogProps } from '@mui/material';
import { useId, useRef, type FormEvent, type ReactNode, type Ref } from 'react';

interface AppDialogProps {
    open?: boolean;
    onClose: () => void;
    /** The dialog's name */
    title: ReactNode;
    /** Its description: a paragraph under the title, read out with the name */
    description?: ReactNode;
    /** The ids of more of the content to read out as its description */
    describedBy?: string;
    /** The button that closes the dialog doing nothing ("Cancel", "Close", "Keep editing"), first of its actions */
    cancel?: string;
    /** Start on that button, so that Enter does nothing: for a dialog that asks before something that cannot be undone */
    focusCancel?: boolean;
    /** The dialog's other actions, after the cancel button */
    actions?: ReactNode;
    /** An × in the title bar that closes it, for a dialog with nothing to cancel */
    closeButton?: boolean;
    /** The dialog is a form: Enter in a field, or an action of type submit, submits it */
    onSubmit?: () => void;
    children?: ReactNode;
    maxWidth?: DialogProps['maxWidth'];
    /** Rules above and below the content, for content that scrolls */
    dividers?: boolean;
    scroll?: DialogProps['scroll'];
    disableRestoreFocus?: boolean;
    onEntered?: () => void;
    onExited?: () => void;
    ref?: Ref<HTMLDivElement>;
}

/**
 * The page's dialogs: a title that names it, an optional description that is read out with the name, the content, and
 * the actions with the cancel button first. Full width up to `maxWidth`.
 */
export function AppDialog({ open = true, onClose, title, description, describedBy, cancel, focusCancel = false, actions, closeButton = false,
    onSubmit, children, maxWidth = 'sm', dividers = false, scroll, disableRestoreFocus, onEntered, onExited, ref }: AppDialogProps) {
    const id = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const descriptionIds = [description !== undefined ? `${id}-description` : null, describedBy].filter(Boolean).join(' ') || undefined;
    const body = <>
        <DialogTitle id={`${id}-title`} sx={closeButton ? { display: 'flex', alignItems: 'center' } : undefined}>
            {closeButton ? <Box sx={{ flexGrow: 1 }}>{title}</Box> : title}
            {closeButton && <IconButton aria-label="Close" onClick={onClose} size="small"><Close fontSize="small" /></IconButton>}
        </DialogTitle>
        <DialogContent dividers={dividers}>
            {description !== undefined && <DialogContentText id={`${id}-description`} sx={children ? { mb: 2 } : undefined}>{description}</DialogContentText>}
            {children}
        </DialogContent>
        {(cancel || actions) && <DialogActions>
            {cancel && <Button ref={cancelRef} onClick={onClose} color="inherit" autoFocus={focusCancel}>{cancel}</Button>}
            {actions}
        </DialogActions>}
    </>;
    return <Dialog ref={ref} open={open} onClose={onClose} maxWidth={maxWidth} fullWidth scroll={scroll} disableRestoreFocus={disableRestoreFocus}
        aria-labelledby={`${id}-title`} aria-describedby={descriptionIds}
        slotProps={{
            transition: {
                // opened over another dialog, autoFocus alone loses the focus to the dialogs' focus traps
                onEntered: () => { if (focusCancel) cancelRef.current?.focus(); onEntered?.(); },
                onExited,
            },
        }}>
        {onSubmit ? <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>{body}</form> : body}
    </Dialog>;
}
