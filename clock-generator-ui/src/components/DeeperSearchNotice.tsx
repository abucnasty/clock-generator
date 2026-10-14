import { Alert, Button, Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useState } from 'react';
import {
    DEEPER_SEARCH_BUTTON,
    DEEPER_SEARCH_DONE_KEPT,
    DEEPER_SEARCH_DONE_ONCE,
    DEEPER_SEARCH_KEEP_ON,
    DEEPER_SEARCH_KEEP_ON_NOTE,
    DEEPER_SEARCH_OFFER,
    type DeeperSearchNoticeKind,
} from '../utils/deeperSearch';

interface DeeperSearchNoticeProps {
    kind: DeeperSearchNoticeKind;
    /** False whenever Generate would be disabled */
    canSearchDeeper: boolean;
    /** Generates again with the slower searches; `keepOn` also turns "Search for fewer wake-ups" on in the form */
    onSearchDeeper: (keepOn: boolean) => void;
}

/**
 * Under the clock table: the offer to search deeper when the slower searches were left out, or what a run that
 * searched deeper did. A note, not an alert: it follows the player's own action or the arrival of the clocks.
 */
export function DeeperSearchNotice({ kind, canSearchDeeper, onSearchDeeper }: DeeperSearchNoticeProps) {
    if (kind === 'none') {
        return null;
    }
    if (kind === 'offer') {
        return <DeeperSearchOffer canSearchDeeper={canSearchDeeper} onSearchDeeper={onSearchDeeper} />;
    }
    return (
        <Alert severity="info" role="note" sx={{ mt: 1 }}>
            {kind === 'searched-kept' ? DEEPER_SEARCH_DONE_KEPT : DEEPER_SEARCH_DONE_ONCE}
        </Alert>
    );
}

/** The offer, mounted only while it shows, so "Keep it on for this build" starts unticked each time */
function DeeperSearchOffer({ canSearchDeeper, onSearchDeeper }: Omit<DeeperSearchNoticeProps, 'kind'>) {
    const [keepOn, setKeepOn] = useState(false);

    return (
        <Alert
            severity="info"
            role="note"
            sx={{ mt: 1 }}
            action={
                <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    disabled={!canSearchDeeper}
                    onClick={() => onSearchDeeper(keepOn)}
                    sx={{ whiteSpace: 'nowrap' }}
                >
                    {DEEPER_SEARCH_BUTTON}
                </Button>
            }
        >
            <Typography variant="body2">{DEEPER_SEARCH_OFFER}</Typography>
            <FormControlLabel
                control={<Checkbox size="small" checked={keepOn} onChange={(_, checked) => setKeepOn(checked)} />}
                label={<Typography variant="body2">{DEEPER_SEARCH_KEEP_ON}</Typography>}
                sx={{ mt: 0.5, mr: 0 }}
            />
            <Typography variant="caption" color="text.secondary" component="p">
                {DEEPER_SEARCH_KEEP_ON_NOTE}
            </Typography>
        </Alert>
    );
}
