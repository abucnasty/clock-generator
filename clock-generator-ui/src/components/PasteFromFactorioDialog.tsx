import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useAnnounce } from '../hooks/useMessages';
import { EXPORT_DEFINITION, PASTE_DIALOG, SIDECAR_NEEDS, type PastePrompt } from '../utils/sidecarGuide';
import { SidecarCopySteps, SidecarModLink } from './IntroCard';

const TITLE_ID = 'paste-from-factorio-title';
const PROMPT_ID = 'paste-from-factorio-prompt';

interface PasteFromFactorioDialogProps {
    /** Why the clipboard could not be used; null when there is nothing to say */
    prompt: PastePrompt | null;
    /** A new number for each prompt, so the same failure twice is read out twice */
    promptId: number;
    onSubmit: (text: string) => void;
    onClose: () => void;
}

/**
 * Opens when Paste from Factorio cannot use the clipboard: why, how to copy the build with the mod, and a box to paste
 * it into. A paste into the box carries on at once; Continue sends what was typed or changed. Open while mounted.
 */
export function PasteFromFactorioDialog({ prompt, promptId, onSubmit, onClose }: PasteFromFactorioDialogProps) {
    const [text, setText] = useState('');
    const announce = useAnnounce();
    // the dialog's description reads the prompt it opens with; each later one (after a paste in the box or Continue, the
    // same failure again too) is read out through the page's live region
    const promptText = prompt?.text ?? null;
    const openedWithRef = useRef(promptId);
    useEffect(() => {
        if (promptText && promptId !== openedWithRef.current) {
            announce(promptText);
        }
    }, [promptId, promptText, announce]);

    return (
        <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={TITLE_ID} aria-describedby={prompt ? PROMPT_ID : undefined}>
            <DialogTitle id={TITLE_ID}>{PASTE_DIALOG.title}</DialogTitle>
            <DialogContent>
                {prompt && (
                    // not an alert of its own: it is read out once, through the page's live region
                    <Alert id={PROMPT_ID} role="none" severity={prompt.severity} sx={{ mb: 2 }}>
                        {prompt.text}
                    </Alert>
                )}
                <Typography variant="body2" component="div">
                    Copy your build with the <SidecarModLink />: {EXPORT_DEFINITION} {SIDECAR_NEEDS}
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
                <Button onClick={onClose} color="inherit">{PASTE_DIALOG.cancel}</Button>
                {/* stays focusable while a paste is read: the parent takes one at a time */}
                <Button variant="contained" color="secondary" disabled={text.trim() === ''} onClick={() => onSubmit(text)}>
                    {PASTE_DIALOG.continue}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
