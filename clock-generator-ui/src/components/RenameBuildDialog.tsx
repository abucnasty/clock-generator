import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useState } from 'react';

interface RenameBuildDialogProps {
    open: boolean;
    /** The build's own name, or '' when it is named after its target recipe */
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
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="xs"
            fullWidth
            disableRestoreFocus
            slotProps={{ transition: { onExited } }}
        >
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    onSave(name);
                }}
            >
                <DialogTitle>Rename build</DialogTitle>
                <DialogContent>
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
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} color="inherit">Cancel</Button>
                    <Button type="submit" variant="contained" color="secondary">Save</Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
