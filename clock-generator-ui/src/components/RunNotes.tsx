import { Box, Typography } from '@mui/material';
import { pickGoneNote, STOPPED_NOTE } from '../utils/resultsCache';

/**
 * What to know about the run whose clocks are shown: that the player stopped it, and that it did not make the clock
 * they had picked. Not a live region: the same is announced when it happens.
 */
export function RunNotes({ stoppedEarly, pickGone }: { stoppedEarly: boolean; pickGone: { label: string } | null }) {
    if (!stoppedEarly && pickGone === null) {
        return null;
    }
    return (
        <Box sx={{ mb: 2 }} data-run-notes="">
            {stoppedEarly && <Typography variant="body2" color="text.secondary">{STOPPED_NOTE}</Typography>}
            {pickGone && <Typography variant="body2" color="text.secondary">{pickGoneNote(pickGone.label)}</Typography>}
        </Box>
    );
}
