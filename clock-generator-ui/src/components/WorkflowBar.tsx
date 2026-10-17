import { Check, ContentCopy, Warning } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, LinearProgress, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useAnnounce } from '../hooks/useMessages';
import type { GenerationProgressStore } from '../hooks/useSimulationWorker';
import { CHECK_TEXT, type CheckStatus } from '../utils/checkThenGenerate';
import { ELEMENT_IDS, type Problem } from '../utils/firstProblem';
import { validationCountLabel } from '../utils/buildValidation';
import { STALE_COPY_TOOLTIP, type GeneratedFor } from '../utils/resultsStaleness';
import { COPY_CURRENT_BEST_TOOLTIP } from '../utils/rateWarning';
import type { RunStop } from '../utils/resultsCache';
import { workflowAnnouncement, type WorkflowSnapshot } from '../utils/workflowAnnouncement';
import type { NextStep } from '../utils/nextStep';
import { GenerationProgressStatus } from './BlueprintOutput';

export type WorkflowView = 'configure' | 'results';

/** Before the selected clock's name in the bar */
const SELECTED_CLOCK_PREFIX = 'Selected clock: ';
/** The note's line in the bar: its button (23px) and the 8px under it */

interface WorkflowBarProps {
    identity?: ReactNode;
    entryAction?: ReactNode;
    menu?: ReactNode;
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
    /** The filled action; null when a current recovery offers the next step outside this toolbar. */
    primaryAction: NextStep | null;
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
    /** Blueprint of the selected clock, once one is generated */
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
    /** What the clocks were made for, while the build has changed since; copying then asks first. Null when not */
    staleFor: GeneratedFor | null;
    /** Every Copy button says "Copied" for a moment after any of them copied */
    copied: boolean;
    /** Copies the blueprint, or asks first for the clock of an earlier build (the copy every Copy button shares) */
    onCopy: () => void;
    /** Blocking validation errors, shared with the Build validation panel. */
    problems: Problem[];
    /** Guidance for an empty build; validation details stay in the panel. */
    note: Problem | null;
    /** Nothing has been entered yet: the note is the next step, not a problem, and there is no count */
    startHere: boolean;
    /** Shows and focuses where a problem is fixed */
    onGoToProblem: (problem: Problem) => void;
    /** A generation, or the check Generate starts first, is running: the progress row shows Cancel */
    running: boolean;
    /** Stops the generation, or Generate's check, at once */
    onCancel: () => void;
    /** The last Cancel, announced once */
    lastStop: RunStop | null;
    /** Bumped when kept clocks come back on an empty Results, announced */
    restoredId: number;
    /** The name of the picked clock the last run did not make; null when it did, or there was no pick */
    pickGone: string | null;
}

/**
 * The second row of the app bar, so it stays in view with it: switches between configuring the build and its results,
 * and keeps the steps of the workflow (check, generate, copy the blueprint) one click away from either.
 */
export function WorkflowBar({
    identity,
    entryAction,
    menu,
    view,
    onViewChange,
    isLoading,
    generationFailed,
    progressStore,
    onGenerate,
    onCheckOnly,
    primaryAction,
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
    staleFor,
    copied,
    onCopy,
    problems,
    note,
    startHere,
    onGoToProblem,
    running,
    onCancel,
    lastStop,
    restoredId,
    pickGone,
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
    // A run turns Generate off, which drops the keyboard focus to the page: it goes to Cancel. After Cancel it goes to
    // Generate; when a run ends with it on Cancel (which goes), to the bar's Copy, or Generate when there is none
    const cancelRef = useRef<HTMLButtonElement>(null);
    const generateRef = useRef<HTMLButtonElement>(null);
    const copyRef = useRef<HTMLButtonElement>(null);
    const cancelledRef = useRef(false);
    const wasRunningRef = useRef(running);
    useEffect(() => {
        const was = wasRunningRef.current;
        wasRunningRef.current = running;
        const focused = document.activeElement;
        const fell = focused === null || focused === document.body || (focused instanceof HTMLButtonElement && focused.disabled);
        if (!was && running) {
            if (fell) {
                cancelRef.current?.focus({ preventScroll: true });
            }
        } else if (was && !running) {
            const target = cancelledRef.current ? generateRef.current : fell ? copyRef.current ?? generateRef.current : null;
            cancelledRef.current = false;
            target?.focus({ preventScroll: true });
        }
    }, [running]);

    // any warning colours the button and gives it the warning icon. Filled when it is the next step: yellow when the
    // clock warns, green when not; the copy of an old clock is the one to think twice about, never filled
    const warns = rateWarning !== null || staleFor !== null;
    const copyFilled = primaryAction === 'copy-bar' && staleFor === null;
    const copyWarningId = useId();
    const shortCopyLabel = copyLabel.split(' (')[0];
    // with problems Generate stays on but goes to the first one instead (2.3): nothing is ready to commit, so nothing is filled
    const generateFilled = primaryAction === 'generate' && problems.length === 0;

    // what changed in the workflow is read out in the app's one announcements region (checking, generating)
    const hasBlueprint = blueprintString !== null;
    const lastSnapshot = useRef<WorkflowSnapshot | null>(null);
    useEffect(() => {
        const snapshot: WorkflowSnapshot = {
            checkStatus, checkedForGenerate, isLoading, failed: generationFailed, hasBlueprint, selectedLabel, selectedId, selectionQuiet,
            stop: lastStop, restoredId, pickGone,
        };
        const previous = lastSnapshot.current;
        lastSnapshot.current = snapshot;
        const text = previous && workflowAnnouncement(previous, snapshot);
        if (text) {
            announce(text);
        }
    }, [checkStatus, checkedForGenerate, isLoading, generationFailed, hasBlueprint, selectedLabel, selectedId, selectionQuiet, lastStop, restoredId, pickGone, announce]);

    // while a run makes clocks, Copy takes the best so far
    const copyTooltip = staleFor ? STALE_COPY_TOOLTIP
        : isLoading ? [COPY_CURRENT_BEST_TOOLTIP, rateWarning].filter(Boolean).join(' ')
        : rateWarning ?? '';

    // from md up the note is in the bar's row, left of the chips, cut with an ellipsis (its words are also the Check only and
    // Generate tooltips and their description); below md it has the line under the bar
    const theme = useTheme();
    const wide = useMediaQuery(theme.breakpoints.up('md'));
    const noteInBar = false;
    const noteNode = (inBar: boolean) => note && (
        note.target ? (
                        <Button
                            id={ELEMENT_IDS.blockReason}
                            variant="text"
                            size="small"
                            title={inBar ? note.text : undefined}
                            color={startHere ? 'inherit' : 'error'}
                            onClick={() => onGoToProblem(note)}
                            // the ripple would tint the text's background on focus; an outline marks the focus instead
                            disableRipple
                            // the lighter red: the error red is 3.9:1 on the bar, under the 4.5 text needs. A link's
                            // underline on hover, not a tinted background, which would take the contrast under 4.5 again.
                            // The first step on a blank build is not a problem: in the bar's own text colour
                            sx={{
                                color: startHere ? 'text.primary' : 'error.light',
                                textTransform: 'none',
                                textAlign: 'inherit',
                                py: 0,
                                px: 0.5,
                                ml: -0.5,
                                minWidth: 0,
                                ...(inBar && { display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }),
                                '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                                // on any focus, not only the keyboard's: Check only moves the focus here when the build has
                                // a problem, and a mouse click must show where it went
                                '&:focus, &.Mui-focusVisible': { outline: '2px solid', outlineColor: startHere ? 'primary.main' : 'error.light', outlineOffset: 2 },
                            }}
                        >
                            {note.text}
                        </Button>
                    ) : (
                        <Typography
                            id={ELEMENT_IDS.blockReason}
                            tabIndex={-1}
                            variant="body2"
                            color="text.secondary"
                            noWrap={inBar}
                            title={inBar ? note.text : undefined}
                            sx={{ '&:focus': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
                        >
                            {note.text}
                        </Typography>
                    )
    );

    const progressNode = (isLoading || checking === 'generate') ? (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flex: 1, minWidth: 0 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                {isLoading ? (
                    <GenerationProgressStatus store={progressStore} />
                ) : (
                    <>
                        <LinearProgress aria-label={CHECK_TEXT.checkingProgress} />
                        <Typography variant="body2" sx={{ mt: 1 }}>{CHECK_TEXT.checkingProgress}</Typography>
                    </>
                )}
            </Box>
            {/* described by its tooltip (describeChild); the progress beside it has a name of its own */}
            <Tooltip title={isLoading ? CHECK_TEXT.cancelTooltip : CHECK_TEXT.cancelCheckTooltip} arrow describeChild placement="bottom" slotProps={{ popper: { disablePortal: true } }}>
                <Button
                    ref={cancelRef}
                    variant="text"
                    color="inherit"
                    size="small"
                    // named in its own case: the button's capitals are only CSS, which Chrome reads into the name
                    aria-label={CHECK_TEXT.cancel}
                    sx={{ flexShrink: 0, mt: -0.5 }}
                    onClick={() => {
                        cancelledRef.current = true;
                        onCancel();
                    }}
                >
                    {CHECK_TEXT.cancel}
                </Button>
            </Tooltip>
        </Box>
    ) : null;

    return (
        <Box>
            <Toolbar variant="dense" sx={{
                display: 'grid', gap: 1, py: 1, px: 2,
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: 'minmax(0, 1fr) auto auto', lg: 'auto auto auto minmax(0, 1fr) auto auto' },
                gridTemplateAreas: {
                    xs: '"identity menu" "navigation entry" "actions actions"',
                    sm: '"identity entry menu" "navigation actions actions"',
                    lg: '"identity entry navigation spacer actions menu"',
                },
            }}>
                <Box sx={{ gridArea: 'identity', minWidth: 0 }}>{identity}</Box>
                <Box sx={{ gridArea: 'entry', justifySelf: 'end' }}>{entryAction}</Box>
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={(_, value) => { if (value) onViewChange(value); }}
                    size="small"
                    sx={{ gridArea: 'navigation', justifySelf: 'start' }}
                    aria-label="Configure the build or look at its results"
                    // always in the header: where focus goes back to when what it was on has gone
                    data-focus-fallback=""
                >
                    <ToggleButton value="configure">Configure</ToggleButton>
                    <ToggleButton value="results">Results</ToggleButton>
                </ToggleButtonGroup>

                {noteInBar && <Box sx={{ flex: '1 1 0', minWidth: 0 }}>{noteNode(true)}</Box>}

                {/* the actions wrap together and stay on the right, instead of one dropping to a row of its own */}
                <Box sx={{ gridArea: 'actions', display: 'flex', flexWrap: { xs: 'wrap', sm: 'nowrap' }, alignItems: 'center', justifyContent: 'flex-end', gap: 1,
                    '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
                    {/* the note under the buttons says where they go instead of checking; it describes both, and is their
                        tooltip too. Above the buttons, so that the tooltip does not cover the note it repeats */}
                    <Tooltip title={note?.text ?? CHECK_TEXT.checkOnlyTooltip} arrow describeChild placement="top" slotProps={{ popper: { disablePortal: true } }}>
                        {/* a disabled button fires no events, so the tooltip listens on the wrapper */}
                        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline-flex' } }}>
                            <Button
                                ref={checkOnlyRef}
                                variant="text"
                                color="inherit"
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
                        </Box>
                    </Tooltip>
                    <Tooltip title={note?.text ?? CHECK_TEXT.generateTooltip} arrow describeChild placement="top" slotProps={{ popper: { disablePortal: true } }}>
                        <span>
                            {/* filled only when it is the next step (generateFilled); a blank build has problems, so there
                                the next step is the recipe (or the intro card's Paste) and Generate is outlined */}
                            <Button
                                ref={generateRef}
                                variant={generateFilled ? 'contained' : 'outlined'}
                                size="small"
                                onClick={onGenerate}
                                color={generateFilled ? 'secondary' : 'inherit'}
                                disabled={busy}
                                aria-describedby={note ? ELEMENT_IDS.blockReason : undefined}
                                startIcon={isLoading || checking === 'generate' ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined}
                            >
                                {isLoading ? CHECK_TEXT.generating : checking === 'generate' ? CHECK_TEXT.checking : CHECK_TEXT.generate}
                            </Button>
                        </span>
                    </Tooltip>
                    {blueprintString && (
                        <>
                            {selectedLabel && !identity && !noteInBar && (
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    noWrap
                                    title={selectedEngineName ?? undefined}
                                    sx={{ maxWidth: 320, minWidth: 0, flex: '1 1 0', display: { xs: 'none', md: 'block' } }}
                                    data-selected-clock
                                >
                                    {SELECTED_CLOCK_PREFIX}{selectedLabel}
                                </Typography>
                            )}
                            {/* describeChild keeps the button's label as its name. Below it when the actions wrap, so
                                the help leaves Configure/Results reachable; above it when wide, clear of the messages.
                                It stays open under the pointer (WCAG 1.4.13), inside the banner (disablePortal). */}
                            <Tooltip title={copyTooltip} arrow describeChild placement={wide ? 'top' : 'bottom'} slotProps={{ popper: { disablePortal: true } }}>
                                <Button
                                    ref={copyRef}
                                    variant={copyFilled ? 'contained' : 'outlined'}
                                    size="small"
                                    onClick={onCopy}
                                    aria-describedby={warns ? copyWarningId : undefined}
                                    // "Copied" keeps the colour it had
                                    color={warns ? 'warning' : copyFilled ? 'secondary' : 'inherit'}
                                    startIcon={copied ? <Check /> : warns ? <Warning /> : <ContentCopy />}
                                >
                                    {copied ? 'Copied' : shortCopyLabel}
                                </Button>
                            </Tooltip>
                        </>
                    )}
                </Box>
                <Box sx={{ gridArea: 'menu', justifySelf: 'end' }}>{menu}</Box>
            </Toolbar>
            {(problems.length > 0 && !startHere || chip || blueprintString && (staleFor || rateWarning)) && (
                <Box sx={{ px: 2, pb: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                    {problems.length > 0 && !startHere && (
                        <Chip
                            size="small"
                            variant="outlined"
                            color="error"
                            id={!note ? ELEMENT_IDS.blockReason : undefined}
                            label={validationCountLabel(problems.length)}
                            onClick={() => onGoToProblem({ text: 'Build validation', target: { kind: 'validation-panel' } })}
                            aria-label={`${validationCountLabel(problems.length)}. Show build validation.`}
                            // outlined as "Check failed" is, which takes the same place: one look for red in the bar. A
                            // tint under the red would take its words under 4.5:1; hovered, they are underlined
                            sx={{
                                '&:hover, &.Mui-focusVisible': { bgcolor: 'transparent' },
                                '&:hover .MuiChip-label': { textDecoration: 'underline' },
                            }}
                        />
                    )}
                    {chip && !(chip.color === 'error' && problems.length > 0) && (
                        <Chip
                            size="small"
                            variant="outlined"
                            label={chip.label}
                            color={chip.color}
                        />
                    )}
                    {blueprintString && (staleFor || rateWarning) && <Typography id={copyWarningId} variant="body2" color="warning.main">
                        {staleFor ? STALE_COPY_TOOLTIP : rateWarning}
                    </Typography>}
                </Box>
            )}
            {/* Only empty-build guidance gets a line below the toolbar. Errors are summarized by the count above. */}
            {note && (
                <Box
                    sx={{
                        px: { xs: 2, sm: 3 },
                        pb: 1,
                        mt: -0.5,
                        // one line of the note's button (23px) and the padding under it
                        minWidth: 0,
                        display: 'flex',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                    }}
                >
                    {noteNode(false)}
                </Box>
            )}
            {progressNode && (
                <Box sx={{ px: { xs: 2, sm: 3 }, pb: 1 }}>
                    {progressNode}
                </Box>
            )}
        </Box>
    );
}
