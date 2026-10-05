import { Check, ContentCopy } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, Paper, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { useCallback, useState } from 'react';
import type { GenerationProgressStore } from '../hooks/useSimulationWorker';
import { GenerationProgressStatus } from './BlueprintOutput';

export type WorkflowView = 'configure' | 'results';

const VALIDATION_CHIP = {
    'valid': { label: 'Valid', color: 'success' },
    'invalid': { label: 'Invalid', color: 'error' },
    'out-of-date': { label: 'Changed since validation', color: 'warning' },
} as const;

interface WorkflowBarProps {
    view: WorkflowView;
    onViewChange: (view: WorkflowView) => void;
    isLoading: boolean;
    progressStore: GenerationProgressStore;
    onGenerate: () => void;
    generateDisabled: boolean;
    onValidate: () => void;
    validateDisabled: boolean;
    /** Where the Validate step stands for the config as it is now */
    validationStatus: 'none' | 'running' | 'valid' | 'invalid' | 'out-of-date';
    /** Blueprint of the selected potential clock, once one is generated */
    blueprintString: string | null;
    /** Name of the selected potential clock */
    selectedLabel: string | null;
}

/**
 * Stays in view under the app bar: switches between configuring the build and its results, and keeps the steps
 * of the workflow (validate, generate, copy the blueprint) one click away from either.
 */
export function WorkflowBar({
    view,
    onViewChange,
    isLoading,
    progressStore,
    onGenerate,
    generateDisabled,
    onValidate,
    validateDisabled,
    validationStatus,
    blueprintString,
    selectedLabel,
}: WorkflowBarProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!blueprintString) {
            return;
        }
        try {
            await navigator.clipboard.writeText(blueprintString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [blueprintString]);

    return (
        <Paper
            square
            elevation={2}
            sx={{
                position: 'sticky',
                top: { xs: 56, sm: 64 },
                zIndex: (theme) => theme.zIndex.appBar - 1,
                px: 2,
                py: 1,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={(_, value) => { if (value) onViewChange(value); }}
                    size="small"
                    aria-label="Configure the build or look at its results"
                >
                    <ToggleButton value="configure">Configure</ToggleButton>
                    <ToggleButton value="results">Results</ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ flexGrow: 1 }} />

                {blueprintString && (
                    <>
                        {selectedLabel && (
                            <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 320 }}>
                                {selectedLabel}
                            </Typography>
                        )}
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleCopy}
                            color={copied ? 'success' : 'primary'}
                            startIcon={copied ? <Check /> : <ContentCopy />}
                        >
                            {copied ? 'Copied' : 'Copy blueprint'}
                        </Button>
                    </>
                )}
                {validationStatus !== 'none' && validationStatus !== 'running' && (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={VALIDATION_CHIP[validationStatus].label}
                        color={VALIDATION_CHIP[validationStatus].color}
                    />
                )}
                <Button
                    variant="outlined"
                    size="small"
                    onClick={onValidate}
                    disabled={validateDisabled || isLoading || validationStatus === 'running'}
                >
                    {validationStatus === 'running' ? 'Validating...' : 'Validate'}
                </Button>
                <Tooltip title={validationStatus === 'valid' ? '' : 'Validate the configuration first'} arrow>
                    {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                    <span>
                        <Button
                            variant="contained"
                            size="small"
                            onClick={onGenerate}
                            color="secondary"
                            disabled={generateDisabled || isLoading || validationStatus !== 'valid'}
                            startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
                        >
                            {isLoading ? 'Generating...' : 'Generate'}
                        </Button>
                    </span>
                </Tooltip>
            </Box>
            {isLoading && (
                <Box sx={{ mt: 1 }}>
                    <GenerationProgressStatus store={progressStore} />
                </Box>
            )}
        </Paper>
    );
}
