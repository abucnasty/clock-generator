import { Button } from '@mui/material';
import { AppDialog } from './AppDialog';

interface DiscardChangesDialogProps {
    open: boolean;
    /** The whole question, e.g. "Discard changes to Inserter 3's rule?" */
    title: string;
    onKeepEditing: () => void;
    onDiscard: () => void;
}

/** Asks before an editor with unsaved changes is closed. Esc and a click outside it mean Keep editing. */
export function DiscardChangesDialog({ open, title, onKeepEditing, onDiscard }: DiscardChangesDialogProps) {
    return <AppDialog open={open} onClose={onKeepEditing} maxWidth="xs" title={title} description="Your changes have not been saved."
        cancel="Keep editing" focusCancel actions={<Button onClick={onDiscard} color="error">Discard</Button>} />;
}
