import { ContentCopy, Check } from '@mui/icons-material';
import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    LinearProgress,
    Paper,
    TextField,
    Typography,
    Alert,
} from '@mui/material';
import { useCallback, useState } from 'react';
import type { GenerationProgress } from 'clock-generator/browser';

interface BlueprintOutputProps {
    blueprintString: string | null;
    isLoading: boolean;
    progress?: GenerationProgress | null;
    error: string | null;
    simulationDurationTicks?: number;
    onGenerate: () => void;
    disabled?: boolean;
}

export function BlueprintOutput({
    blueprintString,
    isLoading,
    progress,
    error,
    simulationDurationTicks,
    onGenerate,
    disabled,
}: BlueprintOutputProps) {
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

    return (
        <Paper sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                    Generated Blueprint
                </Typography>
                <Button
                    variant="contained"
                    onClick={onGenerate}
                    color="secondary"
                    disabled={disabled || isLoading}
                    startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : undefined}
                >
                    {isLoading ? 'Generating...' : 'Generate Blueprint'}
                </Button>
            </Box>

            {isLoading && (
                <Box sx={{ mb: 2 }}>
                    <LinearProgress
                        variant={progress?.total ? 'determinate' : 'indeterminate'}
                        value={progress?.total ? (progress.completed / progress.total) * 100 : undefined}
                    />
                    <Typography variant="body2" sx={{ mt: 1 }}>
                        {progress
                            ? `${progress.total ? `${progress.completed} of ${progress.total} alternatives done, running: ` : ''}${progress.step}`
                            : 'Starting simulation...'}
                    </Typography>
                    {progress?.detail && (
                        <Typography variant="caption" color="text.secondary">
                            {progress.detail}
                        </Typography>
                    )}
                </Box>
            )}

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            {blueprintString && (
                <>
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
                </>
            )}

            {!blueprintString && !isLoading && !error && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                    Click "Generate Blueprint" to create a clock circuit for your configuration.
                </Typography>
            )}
        </Paper>
    );
}
