import { Check, ContentCopy } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Snackbar, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { useCallback, useState } from 'react';
import type { GenerationProgressStore } from '../hooks/useSimulationWorker';
import { STALE_COPY_LABEL, STALE_COPY_TOOLTIP, type GeneratedFor } from '../utils/resultsStaleness';
import { GenerationProgressStatus } from './BlueprintOutput';
import { StaleCopyDialog } from './StaleCopyDialog';

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
    /** Said when the blueprint is copied: the selected clock does not hold the target rate. Null when it does */
    rateWarning: string | null;
    /** What the clocks were made for, while the build has changed since; copying then asks first. Null when not */
    staleFor: GeneratedFor | null;
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
    rateWarning,
    staleFor,
}: WorkflowBarProps) {
    const [copied, setCopied] = useState(false);
    const [warned, setWarned] = useState(false);
    const [confirmingOld, setConfirmingOld] = useState(false);

    const copyBlueprint = useCallback(async () => {
        if (!blueprintString) {
            return;
        }
        try {
            await navigator.clipboard.writeText(blueprintString);
            setCopied(true);
            setWarned(rateWarning !== null);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [blueprintString, rateWarning]);

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
                        {/* describeChild: the tooltip describes the button, which keeps its label as its name */}
                        <Tooltip title={staleFor ? STALE_COPY_TOOLTIP : rateWarning ?? ''} arrow describeChild>
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={staleFor ? () => setConfirmingOld(true) : copyBlueprint}
                                color={staleFor || rateWarning ? 'warning' : copied ? 'success' : 'primary'}
                                startIcon={copied ? <Check /> : <ContentCopy />}
                            >
                                {copied ? 'Copied' : staleFor ? STALE_COPY_LABEL : 'Copy blueprint'}
                            </Button>
                        </Tooltip>
                        <Snackbar
                            open={warned && rateWarning !== null}
                            autoHideDuration={10000}
                            onClose={() => setWarned(false)}
                            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                        >
                            <Alert severity="warning" variant="filled" onClose={() => setWarned(false)}>
                                Copied. {rateWarning}
                            </Alert>
                        </Snackbar>
                        {staleFor && (
                            <StaleCopyDialog
                                open={confirmingOld && staleFor !== null}
                                generatedFor={staleFor}
                                onCancel={() => setConfirmingOld(false)}
                                onConfirm={() => {
                                    setConfirmingOld(false);
                                    copyBlueprint();
                                }}
                            />
                        )}
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
