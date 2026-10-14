import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useId } from 'react';
import { generatedForText, type GeneratedFor } from '../utils/resultsStaleness';

interface StaleCopyDialogProps {
    open: boolean;
    /** What the clocks were made for */
    generatedFor: GeneratedFor;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Asked before the blueprint of clocks made for an earlier build is copied, from every place it can be copied.
 * Cancel is focused, so Enter copies nothing.
 */
export function StaleCopyDialog({ open, generatedFor, onCancel, onConfirm }: StaleCopyDialogProps) {
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
                    This blueprint is for {generatedForText(generatedFor)}. Your build has changed since, so this clock
                    may not work in it. Generate again to get a clock for the build you have now.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} autoFocus>Cancel</Button>
                <Button onClick={onConfirm} variant="outlined" color="warning">Copy old clock</Button>
            </DialogActions>
        </Dialog>
    );
}
