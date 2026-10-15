import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { PASTE_DIALOG, SIDECAR_NEEDS, type PastePrompt } from '../utils/sidecarGuide';
import { SidecarCopySteps, SidecarModLink } from './IntroCard';

const TITLE_ID = 'paste-from-factorio-title';

interface PasteFromFactorioDialogProps {
    /** Why the clipboard could not be used; null when there is nothing to say */
    prompt: PastePrompt | null;
    /** While what was pasted is being read */
    busy: boolean;
    onSubmit: (text: string) => void;
    onClose: () => void;
}

/**
 * Opens when Paste from Factorio cannot use the clipboard: why, how to copy the build with the mod, and a box to paste
 * it into. A paste into the box carries on at once; Continue sends what was typed or changed. Open while mounted.
 */
export function PasteFromFactorioDialog({ prompt, busy, onSubmit, onClose }: PasteFromFactorioDialogProps) {
    const [text, setText] = useState('');

    return (
        <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={TITLE_ID}>
            <DialogTitle id={TITLE_ID}>{PASTE_DIALOG.title}</DialogTitle>
            <DialogContent>
                {prompt && (
                    <Alert severity={prompt.severity} sx={{ mb: 2 }}>
                        {prompt.text}
                    </Alert>
                )}
                <Typography variant="body2" component="div">
                    Copy your build with the <SidecarModLink />. {SIDECAR_NEEDS}
                    <SidecarCopySteps />
                    {PASTE_DIALOG.boxStep}
                </Typography>
                <TextField
                    label={PASTE_DIALOG.boxLabel}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    // the text lands in the box too, so a paste that fails shows what it was
                    onPaste={(event) => onSubmit(event.clipboardData.getData('text'))}
                    multiline
                    minRows={3}
                    maxRows={8}
                    fullWidth
                    autoFocus
                    sx={{ mt: 2 }}
                    slotProps={{ htmlInput: { spellCheck: false } }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{PASTE_DIALOG.cancel}</Button>
                <Button variant="contained" color="secondary" disabled={busy || text.trim() === ''} onClick={() => onSubmit(text)}>
                    {PASTE_DIALOG.continue}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
