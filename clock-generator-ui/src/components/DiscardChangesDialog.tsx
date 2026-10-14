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
            // opened over another dialog, autoFocus alone loses the focus to the dialogs' focus traps
            slotProps={{ transition: { onEntered: () => keepEditingRef.current?.focus() } }}
        >
            <DialogTitle id={`${id}-title`}>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText id={`${id}-description`}>
                    Your changes have not been saved.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button ref={keepEditingRef} onClick={onKeepEditing} autoFocus>
                    Keep editing
                </Button>
                <Button onClick={onDiscard} color="error">
                    Discard
                </Button>
            </DialogActions>
        </Dialog>
    );
}
