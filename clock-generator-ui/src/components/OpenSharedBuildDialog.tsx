import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

const SUMMARY_ID = 'shared-build-summary';
const PLACE_ID = 'shared-build-place';

interface OpenSharedBuildDialogProps {
    open: boolean;
    /** The shared build's name, or its recipe's */
    title: string;
    /** "Logistic science pack at 240/s · 11 copies · 1 machine, 3 inserters" */
    summary: string;
    /** Where it goes: a new build, or the place of the empty one */
    placeNote: string;
    onOpen: () => void;
    onCancel: () => void;
    /** After it has closed: focus goes to the build switcher, as the dialog had no opener */
    onExited: () => void;
}

/** Asks before a share link adds its build to Your builds */
export function OpenSharedBuildDialog({ open, title, summary, placeNote, onOpen, onCancel, onExited }: OpenSharedBuildDialogProps) {
    return (
        <Dialog
            open={open}
            onClose={onCancel}
            maxWidth="sm"
            fullWidth
            disableRestoreFocus
            aria-describedby={`${SUMMARY_ID} ${PLACE_ID}`}
            slotProps={{ transition: { onExited } }}
        >
            <DialogTitle>Open a shared build?</DialogTitle>
            <DialogContent>
                <Typography variant="subtitle1" component="p" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {title}
                </Typography>
                <Typography id={SUMMARY_ID} variant="body2" sx={{ mb: 2 }}>
                    {summary}
                </Typography>
                <Typography id={PLACE_ID} variant="body2">
                    {placeNote}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} color="inherit">Cancel</Button>
                <Button onClick={onOpen} variant="contained" color="secondary" autoFocus>Open build</Button>
            </DialogActions>
        </Dialog>
    );
}
