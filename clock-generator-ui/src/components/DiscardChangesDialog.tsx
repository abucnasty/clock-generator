import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
} from '@mui/material';
import { useId, useRef } from 'react';


interface DiscardChangesDialogProps {
    open: boolean;
    /** The whole question, e.g. "Discard changes to Inserter 3's rule?" */
    title: string;
    onKeepEditing: () => void;
    onDiscard: () => void;
}

/** Asks before an editor with unsaved changes is closed. Esc and a click outside it mean Keep editing. */
export function DiscardChangesDialog({ open, title, onKeepEditing, onDiscard }: DiscardChangesDialogProps) {
    const id = useId();
    const keepEditingRef = useRef<HTMLButtonElement>(null);
    return (
        <Dialog
            open={open}
            onClose={onKeepEditing}
            maxWidth="xs"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            slotProps={{
                // the plain paper colour, without the dark theme's elevation overlay (a background image), which
                // lightens it to #474747 and leaves the buttons' text below 4.5:1
                // and a divider-grey edge, so that it stands out from the dimmed dialog behind it
                paper: { sx: { bgcolor: 'background.paper', backgroundImage: 'none', border: 1, borderColor: 'divider' } },
                // opened over another dialog, autoFocus alone loses the focus to the dialogs' focus traps
                transition: { onEntered: () => keepEditingRef.current?.focus() },
            }}
        >
            <DialogTitle id={`${id}-title`}>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText id={`${id}-description`}>
                    Your changes have not been saved.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                {/* the theme's focus ring marks focus; the focus ripple would lower the text's contrast */}
                <Button ref={keepEditingRef} onClick={onKeepEditing} autoFocus disableFocusRipple>
                    Keep editing
                </Button>
                <Button onClick={onDiscard} color="error" disableFocusRipple>
                    Discard
                </Button>
            </DialogActions>
        </Dialog>
    );
}
