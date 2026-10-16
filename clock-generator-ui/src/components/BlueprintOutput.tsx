import { ContentCopy, Check, Warning } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    IconButton,
    LinearProgress,
    TextField,
    Typography,
} from '@mui/material';
import { useGenerationProgress, type GenerationProgressStore } from '../hooks/useSimulationWorker';
import { BUTTON_NAMES, FIELD_NAMES, PROGRESS_NAMES } from '../utils/a11yLabels';
import { SURFACE } from '../theme/tokens';
import { durationText } from '../utils/numberText';
import { STALE_BLUEPRINT_NOTE, STALE_COPY_LABEL, type GeneratedFor } from '../utils/resultsStaleness';

interface BlueprintOutputProps {
    blueprintString: string | null;
    simulationDurationTicks?: number;
    /** Shown over the blueprint: the selected clock does not hold the target rate. Null when it does */
    rateWarning?: string | null;
    /**
     * What the clocks were made for, while the build has changed since. The string is then hidden, so it cannot be
     * copied by hand, and copying asks first. Null when not
     */
    staleFor?: GeneratedFor | null;
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** The copy every Copy button shares: it asks first for the clock of an earlier build */
    onCopy: () => void;
}

/** Under the string */
const STRING_CAPTION = 'Copy this string and import it in Factorio 2.1. The steps are at the top of Results.';
/** Before the clock's period over the string */
const CLOCK_PERIOD_LABEL = 'Clock period:';

/**
 * The selected clock's blueprint string, for reading or copying by hand. The Details tab it is in names it, so it has
 * no heading of its own.
 */
export function BlueprintOutput({ blueprintString, simulationDurationTicks, rateWarning, staleFor, copied, onCopy }: BlueprintOutputProps) {
    if (!blueprintString) {
        return null;
    }

    return (
        <Box>
            {simulationDurationTicks !== undefined && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {CLOCK_PERIOD_LABEL} {durationText(simulationDurationTicks)}
                </Typography>
            )}
            {rateWarning && (
                <Alert severity="warning" sx={{ mb: 1 }}>{rateWarning}</Alert>
            )}
            {staleFor ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="text.secondary">
                        {STALE_BLUEPRINT_NOTE}
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        color="warning"
                        onClick={onCopy}
                        startIcon={copied ? <Check /> : <Warning />}
                    >
                        {copied ? 'Copied' : STALE_COPY_LABEL}
                    </Button>
                </Box>
            ) : (
                // the Copy button beside the box, not over it, so it never covers the string
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <TextField
                        multiline
                        rows={6}
                        fullWidth
                        value={blueprintString}
                        slotProps={{
                            htmlInput: { 'aria-label': FIELD_NAMES.blueprintString },
                            // an inset box, as the game draws a text field
                            input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.75rem', bgcolor: SURFACE.inset } },
                        }}
                    />
                    <IconButton
                        onClick={onCopy}
                        aria-label={copied ? BUTTON_NAMES.blueprintCopied : BUTTON_NAMES.copyBlueprintString}
                        color={copied ? 'success' : 'default'}
                        sx={{ flexShrink: 0 }}
                    >
                        {copied ? <Check /> : <ContentCopy />}
                    </IconButton>
                </Box>
            )}
            {!staleFor && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {STRING_CAPTION}
                </Typography>
            )}
        </Box>
    );
}

export function GenerationProgressStatus({ store }: { store: GenerationProgressStore }) {
    const progress = useGenerationProgress(store);
    return (
        <Box>
            <LinearProgress
                aria-label={PROGRESS_NAMES.generating}
                variant={progress?.total ? 'determinate' : 'indeterminate'}
                value={progress?.total ? (progress.completed / progress.total) * 100 : undefined}
            />
            <Typography variant="body2" sx={{ mt: 1 }}>
                {progress
                    ? `${progress.total ? `${progress.completed} of ${progress.total} clocks done, running: ` : ''}${progress.step}`
                    : 'Starting simulation...'}
            </Typography>
            {progress?.detail && (
                <Typography variant="caption" color="text.secondary">
                    {progress.detail}
                </Typography>
            )}
        </Box>
    );
}
