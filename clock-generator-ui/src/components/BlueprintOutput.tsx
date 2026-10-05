import { ContentCopy, Check } from '@mui/icons-material';
import {
    Box,
    IconButton,
    LinearProgress,
    Paper,
    TextField,
    Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';
import { useGenerationProgress, type GenerationProgressStore } from '../hooks/useSimulationWorker';

interface BlueprintOutputProps {
    blueprintString: string | null;
    simulationDurationTicks?: number;
}

/** The selected potential clock's blueprint string, for reading or copying by hand */
export function BlueprintOutput({ blueprintString, simulationDurationTicks }: BlueprintOutputProps) {
    const [copied, setCopied] = useState(false);

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
            <Box sx={{ position: 'relative' }}>
                <TextField
                    multiline
                    rows={6}
                    fullWidth
                    value={blueprintString}
                    InputProps={{
                        readOnly: true,
                        sx: { fontFamily: 'monospace', fontSize: '0.75rem' },
                    }}
                />
                <IconButton
                    onClick={handleCopy}
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
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Copy this string and paste it in Factorio (Ctrl+V while in blueprint library)
            </Typography>
        </Paper>
    );
}

export function GenerationProgressStatus({ store }: { store: GenerationProgressStore }) {
    const progress = useGenerationProgress(store);
    return (
        <Box>
            <LinearProgress
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
