import { Button, TextField } from '@mui/material';
import { AppDialog } from './AppDialog';
import { useState } from 'react';

interface RenameBuildDialogProps {
    open: boolean;
    /** The name the build shows: its own, or its recipe's when it is named after its target recipe */
    initialName: string;
    /** The text as typed; the caller cleans it */
    onSave: (name: string) => void;
    onClose: () => void;
    /** After it has closed: focus goes back to the build switcher */
    onExited?: () => void;
}

/** Names the open build; an empty name goes back to naming it after its target recipe */
export function RenameBuildDialog({ open, initialName, onSave, onClose, onExited }: RenameBuildDialogProps) {
    // a new dialog per opening (the caller mounts it while open), so the field starts from the name each time
    const [name, setName] = useState(initialName);
    return (
        <AppDialog open={open} onClose={onClose} maxWidth="xs" title="Rename build" disableRestoreFocus onExited={onExited} onSubmit={() => onSave(name)}
            cancel="Cancel" actions={<Button type="submit" variant="contained" color="secondary">Save</Button>}>
            <TextField
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                onFocus={(event) => event.target.select()}
                fullWidth
                margin="dense"
                helperText="Leave it empty to name the build after its target recipe."
                slotProps={{ htmlInput: { maxLength: 200 } }}
            />
        </AppDialog>
    );
}
