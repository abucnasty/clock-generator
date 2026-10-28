import { Button, Typography } from '@mui/material';
import { AppDialog } from './AppDialog';

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
        <AppDialog open={open} onClose={onCancel} title="Open a shared build?" describedBy={`${SUMMARY_ID} ${PLACE_ID}`} disableRestoreFocus onExited={onExited}
            cancel="Cancel" actions={<Button onClick={onOpen} variant="contained" color="secondary" autoFocus>Open build</Button>}>
            <Typography variant="subtitle1" component="p" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {title}
            </Typography>
            <Typography id={SUMMARY_ID} variant="body2" sx={{ mb: 2 }}>
                {summary}
            </Typography>
            <Typography id={PLACE_ID} variant="body2">
                {placeNote}
            </Typography>
        </AppDialog>
    );
}
