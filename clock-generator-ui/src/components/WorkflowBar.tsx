import { Check, ContentCopy, Warning } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';
import { useAnnounce } from '../hooks/useMessages';
import type { GenerationProgressStore } from '../hooks/useSimulationWorker';
import { CHECK_TEXT, type CheckStatus } from '../utils/checkThenGenerate';
import { ELEMENT_IDS, problemCountLabel, type Problem } from '../utils/firstProblem';
import { STALE_COPY_TOOLTIP, type GeneratedFor } from '../utils/resultsStaleness';
import { workflowAnnouncement, type WorkflowSnapshot } from '../utils/workflowAnnouncement';
import { GenerationProgressStatus } from './BlueprintOutput';

export type WorkflowView = 'configure' | 'results';

/** Before the selected clock's name in the bar */
const SELECTED_CLOCK_PREFIX = 'Selected clock: ';

interface WorkflowBarProps {
    view: WorkflowView;
    onViewChange: (view: WorkflowView) => void;
    isLoading: boolean;
    /** The last generation stopped on an error */
    generationFailed: boolean;
    progressStore: GenerationProgressStore;
    /** Checks the build, then generates; or goes to what stops it */
    onGenerate: () => void;
    /** Checks the build without generating and without moving the page */
    onCheckOnly: () => void;
    /** A check or a generation is running: both buttons are off */
    busy: boolean;
    /** Which button's check is running, for its label; null when none is */
    checking: 'generate' | 'check-only' | null;
    /** Where the check stands for the build as it is now, for the announcements */
    checkStatus: CheckStatus;
    /** The running or last check was started by Generate, which leads on to the clocks or to the reason it failed */
    checkedForGenerate: boolean;
    /** The result of the last check for this build, as a chip; null when there is none to show */
    chip: { label: string; color: 'success' | 'error' } | null;
    /** Blueprint of the selected potential clock, once one is generated */
    blueprintString: string | null;
    /** Name of the selected clock by what it is for ("Fewest wake-ups") */
    selectedLabel: string | null;
    /** The engine's name of the selected clock, which says how it is made; shown when the name is pointed at */
    selectedEngineName: string | null;
    /** Id of the selected clock, which tells apart two of the same name */
    selectedId: string | null;
    /** The selection last changed by the card's Back to recommended, whose focus on the name reads it: not announced */
    selectionQuiet: boolean;
    /** Said when the blueprint is copied: the selected clock does not hold the target rate. Null when it does */
    rateWarning: string | null;
    /** What the Copy button says when it has not just been used: "Copy blueprint", "… below target", or "Copy old clock…" */
    copyLabel: string;
    /** The selected clock runs short of the target rate: Copy is then a filled warning button */
    belowTarget: boolean;
    /** What the clocks were made for, while the build has changed since; copying then asks first. Null when not */
    staleFor: GeneratedFor | null;
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** Copies the blueprint, or asks first for the clock of an earlier build (the copy every Copy button shares) */
    onCopy: () => void;
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
export function CopyLabel({ label }: { label: string }) {
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
    generationFailed,
    progressStore,
    onGenerate,
    onCheckOnly,
    busy,
    checking,
    checkStatus,
    checkedForGenerate,
    chip,
    blueprintString,
    selectedLabel,
    selectedEngineName,
    selectedId,
    selectionQuiet,
    rateWarning,
    copyLabel,
    belowTarget,
    staleFor,
    copied,
    onCopy,
    problems,
    note,
    onGoToProblem,
}: WorkflowBarProps) {
    const announce = useAnnounce();
    // Check only is off while its check runs, which takes the keyboard focus from it: it gets the focus back after
    // (unless the player has put it somewhere since), only for a check this button started: one from the swing plan in
    // Advanced leaves the focus to the plan
    const checkOnlyRef = useRef<HTMLButtonElement>(null);
    const pressedAtRef = useRef<number | null>(null);
    const startedHereRef = useRef(false);
    const checkingRef = useRef(checking);
    useEffect(() => {
        const was = checkingRef.current;
        checkingRef.current = checking;
        if (was === null && checking === 'check-only') {
            // the check starts in the same update as the click, so a press just before it is this button's
            const pressedAt = pressedAtRef.current;
            startedHereRef.current = pressedAt !== null && performance.now() - pressedAt < 1000;
            pressedAtRef.current = null;
        } else if (was === 'check-only' && checking === null) {
            const focused = document.activeElement;
            if (startedHereRef.current && (focused === null || focused === document.body)) {
                checkOnlyRef.current?.focus({ preventScroll: true });
            }
            startedHereRef.current = false;
        }
    }, [checking]);
    // any warning colours the button and gives it the warning icon; only a fresh clock short of the target is filled,
    // since a filled button invites the click, and the copy of an old clock is the one to think twice about
    const warns = rateWarning !== null || staleFor !== null;
    const filled = belowTarget && staleFor === null;

    // what changed in the workflow is read out in the app's one announcements region (checking, generating)
    const hasBlueprint = blueprintString !== null;
    const lastSnapshot = useRef<WorkflowSnapshot | null>(null);
    useEffect(() => {
        const snapshot: WorkflowSnapshot = { checkStatus, checkedForGenerate, isLoading, failed: generationFailed, hasBlueprint, selectedLabel, selectedId, selectionQuiet };
        const previous = lastSnapshot.current;
        lastSnapshot.current = snapshot;
        const text = previous && workflowAnnouncement(previous, snapshot);
        if (text) {
            announce(text);
        }
    }, [checkStatus, checkedForGenerate, isLoading, generationFailed, hasBlueprint, selectedLabel, selectedId, selectionQuiet, announce]);

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
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    noWrap
                                    title={selectedEngineName ?? undefined}
                                    sx={{ maxWidth: 320, minWidth: 0, flex: '1 1 0', display: { xs: 'none', sm: 'block' } }}
                                    data-selected-clock
                                >
                                    {SELECTED_CLOCK_PREFIX}{selectedLabel}
                                </Typography>
                            )}
                            {/* describeChild: the tooltip describes the button, which keeps its label as its name */}
                            <Tooltip title={staleFor ? STALE_COPY_TOOLTIP : rateWarning ?? ''} arrow describeChild>
                                <Button
                                    variant={filled ? 'contained' : 'outlined'}
                                    size="small"
                                    onClick={onCopy}
                                    color={warns ? 'warning' : copied ? 'success' : 'primary'}
                                    startIcon={copied ? <Check /> : warns ? <Warning /> : <ContentCopy />}
                                >
                                    {copied ? 'Copied' : <CopyLabel label={copyLabel} />}
                                </Button>
                            </Tooltip>
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
                            }}
                        />
                    )}
                    {chip && (
                        <Chip
                            size="small"
                            variant="outlined"
                            label={chip.label}
                            color={chip.color}
                            // the lighter shade, for the words and a solid border: the error red is 3.9:1 on the bar, under
                            // the 4.5 text needs, and MUI's border is that red at 70%
                            sx={{ color: `${chip.color}.light`, borderColor: `${chip.color}.light` }}
                        />
                    )}
                    {/* the note under the buttons says where they go instead of checking; it describes both, and is their
                        tooltip too. Above the buttons, so that the tooltip does not cover the note it repeats */}
                    <Tooltip title={note?.text ?? CHECK_TEXT.checkOnlyTooltip} arrow describeChild placement="top">
                        {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                        <span>
                            <Button
                                ref={checkOnlyRef}
                                variant="outlined"
                                size="small"
                                onClick={() => {
                                    pressedAtRef.current = performance.now();
                                    onCheckOnly();
                                }}
                                disabled={busy}
                                aria-describedby={note ? ELEMENT_IDS.blockReason : undefined}
                                startIcon={checking === 'check-only' ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined}
                            >
                                {checking === 'check-only' ? CHECK_TEXT.checking : CHECK_TEXT.checkOnly}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={note?.text ?? CHECK_TEXT.generateTooltip} arrow describeChild placement="top">
                        <span>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={onGenerate}
                                color="secondary"
                                disabled={busy}
                                aria-describedby={note ? ELEMENT_IDS.blockReason : undefined}
                                startIcon={isLoading || checking === 'generate' ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined}
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
                                // on any focus, not only the keyboard's: Check only moves the focus here when the build has
                                // a problem, and a mouse click must show where it went
                                '&:focus, &.Mui-focusVisible': { outline: '2px solid', outlineColor: 'error.light', outlineOffset: 2 },
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
