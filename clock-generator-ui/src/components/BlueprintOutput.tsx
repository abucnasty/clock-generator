import { ContentCopy, Check } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    IconButton,
    LinearProgress,
    Paper,
    TextField,
    Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';
import { useGenerationProgress, type GenerationProgressStore } from '../hooks/useSimulationWorker';
import { BUTTON_NAMES, PROGRESS_NAMES } from '../utils/a11yLabels';
import { STALE_BLUEPRINT_NOTE, STALE_COPY_LABEL, type GeneratedFor } from '../utils/resultsStaleness';
import { StaleCopyDialog } from './StaleCopyDialog';

/** The name of the read-only field holding the blueprint string, which has no visible label */
const BLUEPRINT_STRING_NAME = 'Blueprint string';

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
}

/** The selected potential clock's blueprint string, for reading or copying by hand */
export function BlueprintOutput({ blueprintString, simulationDurationTicks, rateWarning, staleFor }: BlueprintOutputProps) {
    const [copied, setCopied] = useState(false);
    const [confirmingOld, setConfirmingOld] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!blueprintString) return;
        
        try {
            await navigator.clipboard.writeText(blueprintString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [blueprintString]);

    if (!blueprintString) {
        return null;
    }

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            {simulationDurationTicks !== undefined && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Simulation duration: {simulationDurationTicks} ticks (
                    {(simulationDurationTicks / 60).toFixed(2)} seconds)
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
                        onClick={() => setConfirmingOld(true)}
                        startIcon={copied ? <Check /> : <ContentCopy />}
                    >
                        {copied ? 'Copied' : STALE_COPY_LABEL}
                    </Button>
                    <StaleCopyDialog
                        open={confirmingOld && staleFor !== null}
                        generatedFor={staleFor}
                        onCancel={() => setConfirmingOld(false)}
                        onConfirm={() => {
                            setConfirmingOld(false);
                            handleCopy();
                        }}
                    />
                </Box>
            ) : (
                <Box sx={{ position: 'relative' }}>
                    <TextField
                        multiline
                        rows={6}
                        fullWidth
                        value={blueprintString}
                        slotProps={{ htmlInput: { 'aria-label': BLUEPRINT_STRING_NAME } }}
                        InputProps={{
                            readOnly: true,
                            sx: { fontFamily: 'monospace', fontSize: '0.75rem' },
                        }}
                    />
                    <IconButton
                        onClick={handleCopy}
                        aria-label={copied ? BUTTON_NAMES.blueprintCopied : BUTTON_NAMES.copyBlueprintString}
                        sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            bgcolor: 'background.paper',
                        }}
                        color={copied ? 'success' : 'default'}
                    >
                        {copied ? <Check /> : <ContentCopy />}
                    </IconButton>
                </Box>
            )}
            {!staleFor && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Copy this string and paste it in Factorio (Ctrl+V while in blueprint library)
                </Typography>
            )}
        </Paper>
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
                    ? `${progress.total ? `${progress.completed} of ${progress.total} potential clocks done, running: ` : ''}${progress.step}`
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
