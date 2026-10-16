import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useEffect, useId, useRef } from 'react';
import type { BlueprintCopyFailure } from '../hooks/useCopyBlueprint';
import { useGameNames } from '../hooks/useGameNames';
import { focusTargetOutputHeading } from '../utils/introCard';
import { generatedForText, madeAtText } from '../utils/resultsStaleness';

/** A failed attempt's exact snapshot; selecting text never writes to the clipboard or pins a clock. */
export function ManualBlueprintDialog({ failure, onClose }: { failure: BlueprintCopyFailure; onClose: () => void }) {
    const titleId = useId();
    const { recipeLabel } = useGameNames();
    const field = useRef<HTMLTextAreaElement>(null);
    const opener = useRef(document.activeElement);
    useEffect(() => () => {
        if (!(opener.current instanceof HTMLElement) || !opener.current.isConnected) {
            queueMicrotask(focusTargetOutputHeading);
        }
    }, []);
    const selectString = () => {
        field.current?.focus();
        field.current?.select();
    };
    return (
        <Dialog
            open
            onClose={onClose}
            aria-labelledby={titleId}
            maxWidth="sm"
            fullWidth
            slotProps={{ transition: { onEntered: selectString } }}
        >
            <DialogTitle id={titleId}>Blueprint string to copy</DialogTitle>
            <DialogContent>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    This is the blueprint from the failed copy attempt. Select the string, then copy it using your device's copy command.
                </Typography>
                {failure.staleFor && <Alert severity="warning" sx={{ mb: 2 }}>This is an old clock. {generatedForText(failure.staleFor, recipeLabel)}, {madeAtText(failure.staleFor.generatedAt)}.</Alert>}
                {failure.rateWarning && <Alert severity="warning" sx={{ mb: 2 }}>{failure.rateWarning}</Alert>}
                <TextField
                    inputRef={field}
                    label="Blueprint string"
                    value={failure.blueprintString}
                    multiline
                    minRows={4}
                    maxRows={10}
                    fullWidth
                    autoFocus
                    slotProps={{ input: { readOnly: true }, htmlInput: { spellCheck: false } }}
                    sx={{ '& textarea': { fontFamily: 'monospace', overflowWrap: 'anywhere' } }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={selectString} variant="outlined" color="inherit">Select string</Button>
                <Button onClick={onClose} color="inherit">Close</Button>
            </DialogActions>
        </Dialog>
    );
}
