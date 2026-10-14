import { Box, Button, Typography } from '@mui/material';
import { beltResultsLine, type BeltAnswer, type BeltQuestion } from '../utils/beltQuestion';

interface BeltAssumptionLineProps {
    /** The belt question as the generation on screen answered it; null before one */
    assumption: BeltQuestion | null;
    /** What the clocks on screen say of belts that stand still; null when nothing is worth saying, or while busy */
    hint: string | null;
    /** A check or a generation runs: the action starts nothing, and stays in the tab order */
    busy: boolean;
    /** Sets the other answer on the build and generates for it */
    onSwitch: (answer: BeltAnswer) => void;
}

/**
 * What the clocks on screen assume of the input belts, with the action that generates them for the other answer. Shown
 * only when the generation asked the belt question (an inserter took from a belt). Holds no state.
 */
export function BeltAssumptionLine({ assumption, hint, busy, onSwitch }: BeltAssumptionLineProps) {
    if (!assumption?.ask) {
        return null;
    }
    const line = beltResultsLine(assumption.answer);
    return (
        <Box data-belt-assumption="" sx={{ mt: 2, maxWidth: '72ch' }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
                <Typography variant="body2">{line.text}</Typography>
                <Button
                    size="small"
                    variant="text"
                    // not `disabled`: pressing it starts the run that would disable it, and the keyboard focus would
                    // drop to the page; while busy it is announced as dimmed and ignores presses
                    aria-disabled={busy || undefined}
                    onClick={() => {
                        if (!busy) {
                            onSwitch(line.switchTo);
                        }
                    }}
                    sx={busy ? { color: 'text.disabled', cursor: 'default', '&:hover': { bgcolor: 'transparent' } } : undefined}
                >
                    {line.actionLabel}
                </Button>
            </Box>
            {hint !== null && (
                <Typography variant="body2" color="text.secondary">
                    {hint}
                </Typography>
            )}
        </Box>
    );
}
