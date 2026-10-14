import { Alert, Button, Checkbox, FormControlLabel, Tooltip, Typography } from '@mui/material';
import { useEffect, useId, useRef, useState } from 'react';
import {
    DEEPER_SEARCH_BUTTON,
    DEEPER_SEARCH_KEEP_ON,
    DEEPER_SEARCH_KEEP_ON_NOTE,
    DEEPER_SEARCH_OFFER,
    DEEPER_SEARCH_SEARCHING,
    deeperSearchDoneKept,
    deeperSearchDoneOnce,
    type DeeperSearchNoticeKind,
} from '../utils/deeperSearch';
import { ELEMENT_IDS, type Problem } from '../utils/firstProblem';

interface DeeperSearchNoticeProps {
    kind: DeeperSearchNoticeKind;
    /** The recommended clock's label, named after a deeper search; null when there is none */
    recommendedLabel: string | null;
    /** False whenever Generate would be disabled */
    canSearchDeeper: boolean;
    /** Why Search deeper is off, as Generate says it in the workflow bar; null when it is on or a run is going */
    blockedBy: Problem | null;
    /** Generates again with the slower searches; `keepOn` also turns "Search for fewer wake-ups" on in the form */
    onSearchDeeper: (keepOn: boolean) => void;
}

/**
 * Under the clock table: the offer to search deeper when the slower searches were left out, that a deeper search is
 * going, or what a run that searched deeper did. A note, not an alert: it follows the player's own action or the
 * arrival of the clocks. Its message stays the same element from the offer to the end of the run, so the keyboard focus
 * put on it when Search deeper is pressed is not lost.
 */
export function DeeperSearchNotice({ kind, recommendedLabel, canSearchDeeper, blockedBy, onSearchDeeper }: DeeperSearchNoticeProps) {
    const [keepOn, setKeepOn] = useState(false);
    const [offered, setOffered] = useState(kind === 'offer');
    const messageRef = useRef<HTMLParagraphElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const noteId = useId();

    // "Always search deeper" starts unticked each time the offer comes back
    if ((kind === 'offer') !== offered) {
        setOffered(kind === 'offer');
        setKeepOn(false);
    }

    useEffect(() => {
        // the button is disabled while the search goes, which takes the keyboard focus from it: keep it on the note
        const focused = document.activeElement;
        if (kind === 'searching' && (focused === null || focused === document.body || focused === buttonRef.current)) {
            messageRef.current?.focus();
        }
    }, [kind]);

    if (kind === 'none') {
        return null;
    }
    const message = kind === 'offer' ? DEEPER_SEARCH_OFFER
        : kind === 'searching' ? DEEPER_SEARCH_SEARCHING
            : kind === 'searched-kept' ? deeperSearchDoneKept(recommendedLabel) : deeperSearchDoneOnce(recommendedLabel);
    return (
        <Alert
            severity="info"
            role="note"
            sx={{ mt: 1, maxWidth: '72ch' }}
            action={kind === 'offer' || kind === 'searching' ? (
                // the reason is also the text under the workflow bar's buttons, which describes this one for the keyboard
                <Tooltip title={kind === 'offer' ? blockedBy?.text ?? '' : ''} arrow describeChild>
                    {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                    <span>
                        <Button
                            ref={buttonRef}
                            size="small"
                            variant="outlined"
                            color="inherit"
                            disabled={kind === 'searching' || !canSearchDeeper}
                            onClick={() => onSearchDeeper(keepOn)}
                            aria-describedby={kind === 'offer' && blockedBy ? ELEMENT_IDS.blockReason : undefined}
                            sx={{ whiteSpace: 'nowrap' }}
                        >
                            {DEEPER_SEARCH_BUTTON}
                        </Button>
                    </span>
                </Tooltip>
            ) : undefined}
        >
            {/* not a live region of its own: Search deeper puts the focus here, which reads it, and the app's one
                announcements region says when the run starts and ends */}
            <Typography ref={messageRef} variant="body2" tabIndex={-1}>{message}</Typography>
            {kind === 'offer' && (
                <>
                    <FormControlLabel
                        control={(
                            <Checkbox
                                size="small"
                                checked={keepOn}
                                onChange={(_, checked) => setKeepOn(checked)}
                                slotProps={{ input: { 'aria-describedby': noteId } }}
                            />
                        )}
                        label={<Typography variant="body2">{DEEPER_SEARCH_KEEP_ON}</Typography>}
                        sx={{ mt: 0.5, mr: 0 }}
                    />
                    <Typography id={noteId} variant="caption" color="text.secondary" component="p">
                        {DEEPER_SEARCH_KEEP_ON_NOTE}
                    </Typography>
                </>
            )}
        </Alert>
    );
}
