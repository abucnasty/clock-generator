import { Check, ContentCopy, Warning } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotify } from '../hooks/useMessages';
import type { GenerationProgressStore } from '../hooks/useSimulationWorker';
import { CHECK_TEXT } from '../utils/checkThenGenerate';
import { ELEMENT_IDS, problemCountLabel, type Problem } from '../utils/firstProblem';
import { STALE_COPY_TOOLTIP, type GeneratedFor } from '../utils/resultsStaleness';
import { GenerationProgressStatus } from './BlueprintOutput';
import { StaleCopyDialog } from './StaleCopyDialog';

export type WorkflowView = 'configure' | 'results';

interface WorkflowBarProps {
    view: WorkflowView;
    onViewChange: (view: WorkflowView) => void;
    isLoading: boolean;
    progressStore: GenerationProgressStore;
    /** Checks the build, then generates; or goes to what stops it */
    onGenerate: () => void;
    /** Checks the build without generating and without moving the page */
    onCheckOnly: () => void;
    /** A check or a generation is running: both buttons are off */
    busy: boolean;
    /** Which button's check is running, for its label; null when none is */
    checking: 'generate' | 'check-only' | null;
    /** The result of the last check for this build, as a chip; null when there is none to show */
    chip: { label: string; color: 'success' | 'error' } | null;
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
    /** What keeps the build from being clocked, first to fix first; empty when nothing does */
    problems: Problem[];
    /** Where Generate and Check only go instead of checking, said under them; null when they check */
    note: Problem | null;
    /** Shows and focuses where a problem is fixed */
    onGoToProblem: (problem: Problem) => void;
}

/**
 * The Copy button's words. What comes after "Copy blueprint" ("(200/s, below target)") keeps its case: upper-cased, the
 * unit would read "200/S"
 */
function CopyLabel({ label }: { label: string }) {
    const at = label.indexOf(' (');
    if (at < 0) {
        return label;
    }
    // one span: the button lays its children out as flex items, which would drop the space between them
    return (
        <span>
            {label.slice(0, at)} <Box component="span" sx={{ textTransform: 'none' }}>{label.slice(at + 1)}</Box>
        </span>
    );
}

/**
 * The second row of the app bar, so it stays in view with it: switches between configuring the build and its results,
 * and keeps the steps of the workflow (check, generate, copy the blueprint) one click away from either.
 */
export function WorkflowBar({
    view,
    onViewChange,
    isLoading,
    progressStore,
    onGenerate,
    onCheckOnly,
    busy,
    checking,
    chip,
    blueprintString,
    selectedLabel,
    rateWarning,
    copyLabel,
    belowTarget,
    staleFor,
    problems,
    note,
    onGoToProblem,
}: WorkflowBarProps) {
    const [copied, setCopied] = useState(false);
    const [confirmingOld, setConfirmingOld] = useState(false);
    const notify = useNotify();
    // Check only is off while its check runs, which takes the keyboard focus from it: it gets the focus back after
    // (unless the player has put it somewhere since)
    const checkOnlyRef = useRef<HTMLButtonElement>(null);
    const checkingRef = useRef(checking);
    useEffect(() => {
        const was = checkingRef.current;
        checkingRef.current = checking;
        const focused = document.activeElement;
        if (was === 'check-only' && checking === null && (focused === null || focused === document.body)) {
            checkOnlyRef.current?.focus({ preventScroll: true });
        }
    }, [checking]);
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
                                    variant={filled ? 'contained' : 'outlined'}
                                    size="small"
                                    onClick={staleFor ? () => setConfirmingOld(true) : copyBlueprint}
                                    color={warns ? 'warning' : copied ? 'success' : 'primary'}
                                    startIcon={copied ? <Check /> : warns ? <Warning /> : <ContentCopy />}
                                >
                                    {copied ? 'Copied' : <CopyLabel label={copyLabel} />}
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
                    {chip && (
                        <Chip size="small" variant="outlined" label={chip.label} color={chip.color} />
                    )}
                    {/* the note under the buttons says where they go instead of checking; it describes both */}
                    <Tooltip title={CHECK_TEXT.checkOnlyTooltip} arrow describeChild>
                        {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                        <span>
                            <Button
                                ref={checkOnlyRef}
                                variant="outlined"
                                size="small"
                                onClick={onCheckOnly}
                                disabled={busy}
                                aria-describedby={note ? ELEMENT_IDS.blockReason : undefined}
                                startIcon={checking === 'check-only' ? <CircularProgress size={16} color="inherit" /> : undefined}
                            >
                                {checking === 'check-only' ? CHECK_TEXT.checking : CHECK_TEXT.checkOnly}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={note?.text ?? CHECK_TEXT.generateTooltip} arrow describeChild>
                        <span>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={onGenerate}
                                color="secondary"
                                disabled={busy}
                                aria-describedby={note ? ELEMENT_IDS.blockReason : undefined}
                                startIcon={isLoading || checking === 'generate' ? <CircularProgress size={16} color="inherit" /> : undefined}
                            >
                                {isLoading ? CHECK_TEXT.generating : checking === 'generate' ? CHECK_TEXT.checking : CHECK_TEXT.generate}
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
            </Toolbar>
            {note && (
                // under the buttons it explains, from md up; under the toggle in a narrow window, where the bar wraps
                <Box sx={{ px: { xs: 2, sm: 3 }, pb: 1, mt: -0.5, minWidth: 0, display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' }, textAlign: { xs: 'left', md: 'right' } }}>
                    {note.target ? (
                        <Button
                            id={ELEMENT_IDS.blockReason}
                            variant="text"
                            size="small"
                            color="error"
                            onClick={() => onGoToProblem(note)}
                            // the ripple would tint the text's background on focus; an outline marks the focus instead
                            disableRipple
                            // the lighter red: the error red is 3.9:1 on the bar, under the 4.5 text needs. A link's
                            // underline on hover, not a tinted background, which would take the contrast under 4.5 again
                            sx={{
                                color: 'error.light',
                                textTransform: 'none',
                                textAlign: 'inherit',
                                py: 0,
                                px: 0.5,
                                ml: -0.5,
                                minWidth: 0,
                                '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'error.light', outlineOffset: 2 },
                            }}
                        >
                            {note.text}
                        </Button>
                    ) : (
                        <Typography id={ELEMENT_IDS.blockReason} variant="body2" color="text.secondary">
                            {note.text}
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
