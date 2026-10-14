import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
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
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            aria-labelledby="stale-copy-dialog-title"
            aria-describedby="stale-copy-dialog-text"
        >
            <DialogTitle id="stale-copy-dialog-title">Copy the old clock?</DialogTitle>
            <DialogContent>
                <DialogContentText id="stale-copy-dialog-text">
                    This blueprint is for {generatedForText(generatedFor)}. Your build has changed since, so it may not
                    fit it. Generate again to get a clock for the build you have now.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} autoFocus>Cancel</Button>
                <Button onClick={onConfirm} variant="outlined" color="warning">Copy old clock</Button>
            </DialogActions>
        </Dialog>
    );
}
