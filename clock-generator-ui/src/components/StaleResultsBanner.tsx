import { Alert, Button } from '@mui/material';
import { useGameNames } from '../hooks/useGameNames';
import { STALE_GENERATE_AGAIN, staleResultsMessage, type GeneratedFor } from '../utils/resultsStaleness';

interface StaleResultsBannerProps {
    generatedFor: GeneratedFor;
    /** What changed since, at most three (`buildChangesText`) */
    changes: string[];
    /** Generate's own path: checked first, or to the first problem */
    onGenerate: () => void;
    canGenerate: boolean;
}

/**
 * Over Results while the clocks on screen were made for an earlier build than the one in the form: when they were
 * made, what changed since, and Generate again. It follows the player's own edit, so it is not announced (no alert role).
 */
export function StaleResultsBanner({ generatedFor, changes, onGenerate, canGenerate }: StaleResultsBannerProps) {
    const { recipeLabel } = useGameNames();
    return (
        <Alert
            severity="warning"
            role="none"
            sx={{ mb: 2 }}
            data-stale-banner=""
            action={(
                // outlined: Generate in the bar is the one filled next step while the clocks are old
                <Button variant="outlined" color="inherit" size="small" onClick={onGenerate} disabled={!canGenerate}>
                    {STALE_GENERATE_AGAIN}
                </Button>
            )}
        >
            {staleResultsMessage(generatedFor, changes, { recipeLabel })}
        </Alert>
    );
}
