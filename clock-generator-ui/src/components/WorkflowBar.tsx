import { Check, ContentCopy, Warning } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Portal, Snackbar, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography } from '@mui/material';
import { useCallback, useState } from 'react';
import type { GenerationProgressStore } from '../hooks/useSimulationWorker';
import { ELEMENT_IDS, problemCountLabel, type Problem } from '../utils/firstProblem';
import { STALE_COPY_TOOLTIP, type GeneratedFor } from '../utils/resultsStaleness';
import { GenerationProgressStatus } from './BlueprintOutput';
import { StaleCopyDialog } from './StaleCopyDialog';

export type WorkflowView = 'configure' | 'results';

// a warning is filled and has the warning icon, so it is not taken for the outlined orange buttons beside it
const VALIDATION_CHIP = {
    'valid': { label: 'Valid', color: 'success', variant: 'outlined', warns: false },
    'invalid': { label: 'Invalid', color: 'error', variant: 'outlined', warns: false },
    'out-of-date': { label: 'Changed since validation', color: 'warning', variant: 'filled', warns: true },
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
    /** What the Copy button says when it has not just been used: "Copy blueprint", "… below target", or "Copy old clock…" */
    copyLabel: string;
    /** The selected clock runs short of the target rate: Copy is then a filled warning button */
    belowTarget: boolean;
    /** What the clocks were made for, while the build has changed since; copying then asks first. Null when not */
    staleFor: GeneratedFor | null;
    /** What keeps the build from being validated and generated, first to fix first; empty when nothing does */
    problems: Problem[];
    /** Why each of Validate and Generate is off; null when it is on or says on its own label what it is doing */
    blocked: { validate: Problem | null; generate: Problem | null };
    /** Shows and focuses where a problem is fixed */
    onGoToProblem: (problem: Problem) => void;
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
    copyLabel,
    belowTarget,
    staleFor,
    problems,
    blocked,
    onGoToProblem,
}: WorkflowBarProps) {
    const [copied, setCopied] = useState(false);
    const [warned, setWarned] = useState(false);
    const [confirmingOld, setConfirmingOld] = useState(false);
    // any warning colours the button and gives it the warning icon; only a fresh clock short of the target is filled,
    // since a filled button invites the click, and the copy of an old clock is the one to think twice about
    const warns = rateWarning !== null || staleFor !== null;
    const filled = belowTarget && staleFor === null;

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
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
            <Toolbar variant="dense" sx={{ flexWrap: 'wrap', gap: { xs: 1, sm: 2 }, py: 1 }}>
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
                                    variant={filled ? 'contained' : 'outlined'}
                                    size="small"
                                    onClick={staleFor ? () => setConfirmingOld(true) : copyBlueprint}
                                    color={warns ? 'warning' : copied ? 'success' : 'primary'}
                                    startIcon={copied ? <Check /> : warns ? <Warning /> : <ContentCopy />}
                                >
                                    {copied ? 'Copied' : copyLabel}
                                </Button>
                            </Tooltip>
                            {/* stop-gap until 1.5's shared message host: in a portal, to be drawn above the app bar this bar is part of, at the bottom to stay off the header */}
                            <Portal>
                                <Snackbar
                                    open={warned && rateWarning !== null}
                                    autoHideDuration={10000}
                                    onClose={() => setWarned(false)}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                                >
                                    <Alert severity="warning" variant="filled" onClose={() => setWarned(false)}>
                                        Copied. {rateWarning}
                                    </Alert>
                                </Snackbar>
                            </Portal>
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
                    {problems.length > 0 && (
                        <Chip
                            size="small"
                            color="error"
                            label={problemCountLabel(problems.length)}
                            onClick={() => onGoToProblem(problems[0])}
                            aria-label={`${problemCountLabel(problems.length)}. Go to the first one.`}
                            // black on the red reads at 6.8:1 (white, MUI's choice, only 3.1); lighter, not darker, when
                            // hovered or focused, so that the black stays legible and the chip stands off the bar
                            sx={{
                                color: '#000',
                                '&:hover, &.Mui-focusVisible': { bgcolor: 'error.light' },
                                // until 1.11's focus ring: an outline on the bar, off the red
                                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'error.light', outlineOffset: 2 },
                            }}
                        />
                    )}
                    {validationStatus !== 'none' && validationStatus !== 'running' && (
                        <Chip
                            size="small"
                            variant={VALIDATION_CHIP[validationStatus].variant}
                            label={VALIDATION_CHIP[validationStatus].label}
                            color={VALIDATION_CHIP[validationStatus].color}
                            icon={VALIDATION_CHIP[validationStatus].warns ? <Warning /> : undefined}
                        />
                    )}
                    {/* the reason is also the text under the buttons, which describes them for the keyboard and screen readers */}
                    <Tooltip title={blocked.validate?.text ?? ''} arrow describeChild>
                        {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                        <span>
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={onValidate}
                                disabled={validateDisabled || isLoading || validationStatus === 'running'}
                                aria-describedby={blocked.validate ? ELEMENT_IDS.blockReason : undefined}
                            >
                                {validationStatus === 'running' ? 'Validating...' : 'Validate'}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={blocked.generate?.text ?? ''} arrow describeChild>
                        <span>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={onGenerate}
                                color="secondary"
                                disabled={generateDisabled || isLoading || validationStatus !== 'valid'}
                                aria-describedby={blocked.generate ? ELEMENT_IDS.blockReason : undefined}
                                startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
                            >
                                {isLoading ? 'Generating...' : 'Generate'}
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
            </Toolbar>
            {blocked.generate && (
                <Box sx={{ px: { xs: 2, sm: 3 }, pb: 1, mt: -0.5, minWidth: 0 }}>
                    {blocked.generate.target ? (
                        <Button
                            id={ELEMENT_IDS.blockReason}
                            variant="text"
                            size="small"
                            color="error"
                            onClick={() => blocked.generate && onGoToProblem(blocked.generate)}
                            // the ripple would tint the text's background on focus; an outline marks the focus instead
                            disableRipple
                            // the lighter red: the error red is 3.9:1 on the bar, under the 4.5 text needs. A link's
                            // underline on hover, not a tinted background, which would take the contrast under 4.5 again
                            sx={{
                                color: 'error.light',
                                textTransform: 'none',
                                textAlign: 'left',
                                py: 0,
                                px: 0.5,
                                ml: -0.5,
                                minWidth: 0,
                                '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'error.light', outlineOffset: 2 },
                            }}
                        >
                            {blocked.generate.text}
                        </Button>
                    ) : (
                        <Typography id={ELEMENT_IDS.blockReason} variant="body2" color="text.secondary">
                            {blocked.generate.text}
                        </Typography>
                    )}
                </Box>
            )}
            {isLoading && (
                <Box sx={{ px: { xs: 2, sm: 3 }, pb: 1 }}>
                    <GenerationProgressStatus store={progressStore} />
                </Box>
            )}
        </Box>
    );
}
