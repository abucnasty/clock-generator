import { Warning } from '@mui/icons-material';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useId } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import { staleCopyMessage, type GeneratedFor } from '../utils/resultsStaleness';

interface StaleCopyDialogProps {
    open: boolean;
    /** What the clocks were made for */
    generatedFor: GeneratedFor;
    /** What changed since, as the stale banner lists it */
    changes: string[];
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Asked before the blueprint of clocks made for an earlier build is copied, from every place it can be copied.
 * Cancel is focused, so Enter copies nothing.
 */
export function StaleCopyDialog({ open, generatedFor, changes, onCancel, onConfirm }: StaleCopyDialogProps) {
    const { recipeLabel } = useGameNames();
    const titleId = useId();
    const textId = useId();
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            aria-labelledby={titleId}
            aria-describedby={textId}
        >
            <DialogTitle id={titleId}>Copy the old clock?</DialogTitle>
            <DialogContent>
                <DialogContentText id={textId}>
                    {staleCopyMessage(generatedFor, changes, { recipeLabel })}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} color="inherit" autoFocus>Cancel</Button>
                <Button onClick={onConfirm} variant="outlined" color="warning" startIcon={<Warning />}>Copy old clock</Button>
            </DialogActions>
        </Dialog>
    );
}
