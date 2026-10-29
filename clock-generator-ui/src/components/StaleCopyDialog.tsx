import { Warning } from '@mui/icons-material';
import { Button } from '@mui/material';
import { AppDialog } from './AppDialog';
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
    return <AppDialog open={open} onClose={onCancel} maxWidth="xs" title="Copy the old clock?" description={staleCopyMessage(generatedFor, changes, { recipeLabel })}
        cancel="Cancel" focusCancel actions={<Button onClick={onConfirm} variant="outlined" color="warning" startIcon={<Warning />}>Copy old clock</Button>} />;
}
