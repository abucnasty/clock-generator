import { Check, ContentCopy } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography } from '@mui/material';
import { useCallback, useState } from 'react';
import { useNotify } from '../hooks/useMessages';
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
 * The second row of the app bar, so it stays in view with it: switches between configuring the build and its results,
 * and keeps the steps of the workflow (validate, generate, copy the blueprint) one click away from either.
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
    const [confirmingOld, setConfirmingOld] = useState(false);
    const notify = useNotify();

    const copyBlueprint = useCallback(async () => {
        if (!blueprintString) {
            return;
        }
        try {
            await navigator.clipboard.writeText(blueprintString);
            setCopied(true);
            if (rateWarning !== null) {
                notify({ severity: 'warning', text: `Copied. ${rateWarning}` });
            }
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [blueprintString, rateWarning, notify]);

    return (
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Toolbar variant="dense" sx={{ flexWrap: 'wrap', gap: { xs: 1, sm: 2 }, py: 1 }}>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={(_, value) => { if (value) onViewChange(value); }}
                    size="small"
                    aria-label="Configure the build or look at its results"
                    // always in the header: where focus goes back to when what it was on has gone
                    data-focus-fallback=""
                >
                    <ToggleButton value="configure">Configure</ToggleButton>
                    <ToggleButton value="results">Results</ToggleButton>
                </ToggleButtonGroup>

                {/* the actions wrap together and stay on the right, instead of one dropping to a row of its own */}
                <Box sx={{ ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: { xs: 1, sm: 2 } }}>
                    {blueprintString && (
                        <>
                            {selectedLabel && (
                                <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 320, minWidth: 0, flex: '1 1 0', display: { xs: 'none', sm: 'block' } }}>
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
            </Toolbar>
            {isLoading && (
                <Box sx={{ px: { xs: 2, sm: 3 }, pb: 1 }}>
                    <GenerationProgressStatus store={progressStore} />
                </Box>
            )}
        </Box>
    );
}
