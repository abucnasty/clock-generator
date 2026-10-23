import { Add, Close, ContentCopy, Delete, Fullscreen, FullscreenExit, WarningAmber } from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    FormLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Radio,
    RadioGroup,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { EnableControlMode, TargetType } from 'clock-generator/light';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EnableControlOverride, RuleSet } from '../hooks/useConfigForm';
import { useGameNames } from '../hooks/useGameNames';
import { useAnnounce } from '../hooks/useMessages';
import {
    buildEnableControlOverride,
    draftWindowsOf,
    EMPTY_WINDOW,
    enableControlDraftChanged,
    enableControlDraftOf,
    enableControlOverrideChanged,
    wholeTicksOf,
    type DraftWindow,
} from '../utils/enableControlDraft';
import { BUTTON_NAMES, removeRangeName, windowFieldName } from '../utils/a11yLabels';
import { describeEnableRule, ENABLE_MODE_LABELS } from '../utils/enableRuleLabel';
import { entityLabel as labelOf } from '../utils/entityLabel';
import {
    blockedSummaryOf,
    modeFieldId,
    REPEAT_LABEL,
    ruleFieldId,
    rulePeriodOf,
    ruleProblemsOf,
    ruleWarningsOf,
    type RuleProblem,
} from '../utils/ruleProblems';
import { blueprintNoteOf, periodLineOf, RULE_COPY, ruleSentenceOf } from '../utils/ruleSentence';
import { entityKey, plannedWindowsOf, ticksText } from '../utils/ruleTiming';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { RuleSetEditor } from './RuleSetEditor';
import { createDefaultRuleSet } from './ruleSetUtils';
import { FullscreenProvider } from './FullscreenContext';
import { LatchConfigEditor } from './LatchConfigEditor';
import { QuickTemplateSelect } from './QuickTemplateSelect';
import { RulePeriodStrip } from './RulePeriodStrip';
import { useRuleTiming } from './RuleTimingContext';

export interface CopyFromOption {
    label: string;
    override: EnableControlOverride;
}

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface EnableControlModalProps {
    open: boolean;
    onClose: () => void;
    entityType: 'inserter' | 'drill';
    /** The entity's id, by which the clock on Results keys its wake windows */
    entityId: number;
    entityLabel: string;
    currentOverride?: EnableControlOverride;
    /** A mixed bulk selection can apply its initial Auto draft to every selected row. */
    applyUnchanged?: boolean;
    onSave: (override: EnableControlOverride | undefined) => void;
    sourceType?: SourceSinkType;
    sinkType?: SourceSinkType;
    availableItems?: string[];
    /** The inserter's stack size, for the latched template's amount */
    stackSize?: number;
    /** The items the inserter moves, which a template's item picker starts on */
    movedItems?: string[];
    /** Other entities with configured overrides that can be copied from */
    copyFromOptions?: CopyFromOption[];
}

const MODE_DESCRIPTIONS: Record<EnableControlMode, string> = {
    [EnableControlMode.AUTO]: 'The generator decides when it is on (default).',
    [EnableControlMode.ALWAYS]: 'On all the time, with no combinator in the blueprint.',
    [EnableControlMode.NEVER]: 'Never switched on.',
    [EnableControlMode.CLOCKED]: 'On only during the wake windows you set.',
    [EnableControlMode.CONDITIONAL]: 'On only while your conditions are true.',
};

const MODES: EnableControlMode[] = [
    EnableControlMode.AUTO,
    EnableControlMode.ALWAYS,
    EnableControlMode.NEVER,
    EnableControlMode.CLOCKED,
    EnableControlMode.CONDITIONAL,
];

const DRILL_NO_CONDITIONAL = "Not available for mining drills: conditions read an inserter's source, destination and hand.";
const DRILL_NO_NEVER = 'Not available for a drill into a container: it would fill nothing.';
const REPEAT_HELPER = (cycleTicks: number | null) =>
    cycleTicks === null
        ? 'Leave empty to repeat every crafting cycle.'
        : `Leave empty to repeat every crafting cycle (${ticksText(cycleTicks)} ticks).`;
const PLANNED_CAPTION = (label: string, ranges: { start: number; end: number }[]) =>
    `In the clock on Results, ${label} is on at ${ranges.length === 1 && ranges[0].start === ranges[0].end ? 'tick' : 'ticks'} ${joinRanges(ranges)}.`;
const NO_PLANNED_CAPTION = (label: string) => `The clock on Results has no wake windows for ${label}.`;
const COPY_FROM_QUESTION = (label: string, summary: string) => `Replace this rule with ${label}'s (${summary})?`;
const COPIED = (label: string) => `Rule copied from ${label}.`;
const TEMPLATE_REPLACED = (name: string) => `Conditions replaced with the template ${name}.`;
const TEMPLATE_APPLIED = (name: string) => `Template ${name} applied.`;

function joinRanges(ranges: { start: number; end: number }[]): string {
    const parts = ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`));
    return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---- Exported standalone form (no Dialog wrapper) ----

/** What the rule form would save, whether that differs from what it was opened with, and what stops it saving */
export interface EnableControlFormState {
    override: EnableControlOverride | undefined;
    changed: boolean;
    /** In reading order; a host's Save refuses while there is one and focuses the first one's field */
    problems: RuleProblem[];
}

interface EnableControlFormContentProps {
    entityType: 'inserter' | 'drill';
    /** The entity's id, by which the clock on Results keys its wake windows */
    entityId: number;
    currentOverride?: EnableControlOverride;
    /** Not called when `hideActions` is set, as there is no Save button then */
    onSave?: (override: EnableControlOverride | undefined) => void;
    onCancel?: () => void;
    /** Told what the form would save, as it changes; pass a stable function (a state setter) */
    onDraftChange?: (state: EnableControlFormState) => void;
    /** Hides Clear rule, Cancel and Save, for a host with a Save of its own */
    hideActions?: boolean;
    isFullscreen?: boolean;
    sourceType?: SourceSinkType;
    sinkType?: SourceSinkType;
    availableItems?: string[];
    /** The inserter's stack size, for the latched template's amount */
    stackSize?: number;
    /** The items the inserter moves, which a template's item picker starts on */
    movedItems?: string[];
    copyFromOptions?: CopyFromOption[];
    /** A host with its own Save raises this when that Save is refused, so that every problem shows */
    revealProblems?: number;
}

export function EnableControlFormContent({
    entityType,
    entityId,
    currentOverride,
    onSave,
    onCancel,
    onDraftChange,
    hideActions = false,
    isFullscreen = false,
    sourceType = TargetType.MACHINE,
    sinkType = TargetType.MACHINE,
    availableItems = [],
    stackSize,
    movedItems = [],
    copyFromOptions = [],
    revealProblems = 0,
}: EnableControlFormContentProps) {
    const idPrefix = useId();
    const timing = useRuleTiming();
    const { itemLabel } = useGameNames();
    const announce = useAnnounce();
    const entityName = labelOf(entityType, entityId);
    const planned = plannedWindowsOf(timing, entityKey(entityType, entityId));

    // Initialize state from currentOverride, once: what the form was opened with. A rule that is not Clocked starts its
    // Clocked fields from the clock's wake windows for this entity, when Results are for this build
    const [initial] = useState(() =>
        enableControlDraftOf(currentOverride, planned && timing.periodTicks !== null ? { ranges: planned, periodTicks: timing.periodTicks } : null),
    );

    const [mode, setMode] = useState<EnableControlMode>(initial.mode);
    const [ranges, setRanges] = useState<DraftWindow[]>(initial.ranges);
    const [periodDuration, setPeriodDuration] = useState<string>(initial.periodDuration);
    const [ruleSet, setRuleSet] = useState<RuleSet>(initial.ruleSet);
    const [latchEnabled, setLatchEnabled] = useState<boolean>(initial.latchEnabled);
    const [releaseCondition, setReleaseCondition] = useState<RuleSet | undefined>(initial.releaseCondition);
    // whether Save was pressed while there were problems: the summary shows beside it until they are fixed
    const [saveRefused, setSaveRefused] = useState(false);
    // the rule a "Copy from" choice would copy, while its confirm step is open
    const [copyCandidate, setCopyCandidate] = useState<CopyFromOption | null>(null);
    // the element to focus after the next render: a new field, a heading, a select
    const focusAfterRender = useRef<string | null>(null);
    const copySelectRef = useRef<HTMLInputElement>(null);

    // the rule the form would save, and whether it differs from the one it was opened with
    const draft = useMemo(
        () => ({ mode, ranges, periodDuration, ruleSet, latchEnabled, releaseCondition }),
        [mode, ranges, periodDuration, ruleSet, latchEnabled, releaseCondition],
    );
    const override = useMemo(() => buildEnableControlOverride(draft), [draft]);
    const changed = useMemo(() => enableControlDraftChanged(draft, initial), [draft, initial]);
    // a drill into a container can't be Never on (the config schema's rule), as no drill can be Conditional
    const intoContainer = entityType === 'drill' && sinkType === TargetType.CHEST;
    const problems = useMemo(() => ruleProblemsOf(draft, { entityType, timing, idPrefix, intoContainer }), [draft, entityType, timing, idPrefix, intoContainer]);
    const problemMap = useMemo(() => new Map(problems.map((p) => [p.fieldId, p])), [problems]);
    const warnings = useMemo(() => ruleWarningsOf(draft, timing), [draft, timing]);

    // A field's problem shows once the field has lost focus, or after a refused Save, not while it is still untouched
    // (a new empty window, a new condition). Save refuses and focuses the first problem whether it shows or not.
    const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
    const touchAll = (ids: readonly string[]) =>
        setTouched((previous) => (ids.every((id) => previous.has(id)) ? previous : new Set([...previous, ...ids])));
    // the host's refused Save (the Diagram dialog's) asks for every problem to show: adjusted while rendering, as React
    // recommends for state that follows a prop
    const [revealSeen, setRevealSeen] = useState(revealProblems);
    if (revealProblems !== revealSeen) {
        setRevealSeen(revealProblems);
        touchAll(problems.map((p) => p.fieldId));
    }
    const modeId = modeFieldId(idPrefix, EnableControlMode.CONDITIONAL);
    const neverId = modeFieldId(idPrefix, EnableControlMode.NEVER);
    const shownProblems = useMemo(
        // the drill's problem is the stored rule's, not a field's: it always shows
        () => new Map(problems.filter((p) => p.fieldId === modeId || p.fieldId === neverId || touched.has(p.fieldId)).map((p) => [p.fieldId, p])),
        [problems, touched, modeId, neverId],
    );

    // the rule in words: a wake window with a problem is left out, and the sentence says so; one with nothing typed in it
    // is just not there yet
    const sentence = useMemo(() => {
        if (mode !== EnableControlMode.CLOCKED || override?.mode !== EnableControlMode.CLOCKED) {
            return ruleSentenceOf(override, { itemLabel, cycleTicks: timing.cycleTicks });
        }
        const withProblem = (i: number) => problemMap.has(ruleFieldId(idPrefix, 'start', i)) || problemMap.has(ruleFieldId(idPrefix, 'end', i));
        const blank = (window: DraftWindow) => window.start.trim() === '' && window.end.trim() === '';
        const valid = ranges
            .filter((_, i) => !withProblem(i))
            .map((window) => ({ start: wholeTicksOf(window.start)!, end: wholeTicksOf(window.end)! }));
        return ruleSentenceOf({ ...override, ranges: valid }, {
            itemLabel,
            cycleTicks: timing.cycleTicks,
            invalidWindows: ranges.flatMap((window, i) => (withProblem(i) && !blank(window) ? [i + 1] : [])),
        });
    }, [mode, override, ranges, problemMap, idPrefix, itemLabel, timing.cycleTicks]);

    // a layout effect, so that the host knows of a change before it handles the next key (an Esc right after a click)
    useLayoutEffect(() => {
        onDraftChange?.({ override, changed, problems });
    }, [override, changed, problems, onDraftChange]);

    useEffect(() => {
        const target = focusAfterRender.current;
        if (target === null) return;
        focusAfterRender.current = null;
        if (target === 'copy-select') copySelectRef.current?.focus();
        else document.getElementById(target)?.focus();
    });

    const conditionsHeadingId = `${idPrefix}-conditions`;
    const sentenceId = `${idPrefix}-sentence`;
    const legendId = `${idPrefix}-legend`;
    const copyQuestionId = `${idPrefix}-copy-question`;
    const copyReplaceId = `${idPrefix}-copy-replace`;

    const handleAddRange = () => {
        focusAfterRender.current = ruleFieldId(idPrefix, 'start', ranges.length);
        setRanges([...ranges, { ...EMPTY_WINDOW }]);
    };

    const handleRemoveRange = (index: number) => {
        if (ranges.length > 1) {
            // the focus goes to the window before, or to the one that takes this one's place
            focusAfterRender.current = ruleFieldId(idPrefix, 'start', Math.max(0, index - 1));
            setRanges(ranges.filter((_, i) => i !== index));
        }
    };

    const handleUpdateRange = (index: number, field: 'start' | 'end', value: string) => {
        setRanges(ranges.map((range, i) => (i === index ? { ...range, [field]: value } : range)));
    };

    const handleUseClockWindows = () => {
        if (!planned || timing.periodTicks === null) return;
        setRanges(draftWindowsOf(planned));
        setPeriodDuration(`${timing.periodTicks}`);
    };

    const handleSave = () => {
        if (problems.length > 0) {
            setSaveRefused(true);
            touchAll(problems.map((p) => p.fieldId));
            document.getElementById(problems[0].fieldId)?.focus();
            announce(blockedSummaryOf(problems));
            return;
        }
        onSave?.(override);
    };

    const handleApplyTemplate = (templateRuleSet: RuleSet, templateRelease: RuleSet | undefined, templateName: string, replaced: boolean) => {
        setRuleSet(templateRuleSet);
        if (templateRelease) {
            setLatchEnabled(true);
            setReleaseCondition(templateRelease);
        } else {
            setLatchEnabled(false);
            setReleaseCondition(undefined);
        }
        focusAfterRender.current = conditionsHeadingId;
        announce(replaced ? TEMPLATE_REPLACED(templateName) : TEMPLATE_APPLIED(templateName));
    };

    const applyCopy = (option: CopyFromOption) => {
        const copied = option.override;
        setMode(copied.mode);
        if (copied.mode === EnableControlMode.CLOCKED) {
            setRanges(copied.ranges.length > 0 ? draftWindowsOf(copied.ranges) : [{ ...EMPTY_WINDOW }]);
            setPeriodDuration(copied.period_duration_ticks?.toString() || '');
        } else if (copied.mode === EnableControlMode.CONDITIONAL) {
            setRuleSet(copied.rule_set || createDefaultRuleSet());
            setLatchEnabled(!!copied.latch);
            setReleaseCondition(copied.latch?.release);
        }
        announce(COPIED(option.label));
    };

    // a rule of the player's own is replaced only after they confirm; Auto has nothing to lose
    const handleCopyFrom = (option: CopyFromOption) => {
        if (mode === EnableControlMode.AUTO) {
            applyCopy(option);
        } else {
            focusAfterRender.current = copyReplaceId;
            setCopyCandidate(option);
        }
    };

    const handleClear = () => {
        onSave?.(undefined);
    };

    const hasOverride = currentOverride && currentOverride.mode !== EnableControlMode.AUTO;
    // a drill can't run a Conditional rule (the engine needs an inserter for it); a stored one stays pickable, with its
    // problem, so that the player sees what it is
    const conditionalOff = entityType === 'drill' && currentOverride?.mode !== EnableControlMode.CONDITIONAL;
    // the same for Never on, for a drill into a container
    const neverOff = intoContainer && currentOverride?.mode !== EnableControlMode.NEVER;
    const modeProblems: Partial<Record<EnableControlMode, RuleProblem>> = { [EnableControlMode.CONDITIONAL]: shownProblems.get(modeId), [EnableControlMode.NEVER]: shownProblems.get(neverId) };

    const rulePeriod = mode === EnableControlMode.CLOCKED ? rulePeriodOf(draft, timing) : null;
    const reference = planned && rulePeriod === timing.periodTicks ? planned : null;
    const stripWindows = override?.mode === EnableControlMode.CLOCKED
        ? ranges
            .map((window, i) => ({ window, i }))
            .filter(({ i }) => !problemMap.has(ruleFieldId(idPrefix, 'start', i)) && !problemMap.has(ruleFieldId(idPrefix, 'end', i)))
            .map(({ window }) => ({ start: wholeTicksOf(window.start)!, end: wholeTicksOf(window.end)! }))
        : [];
    const repeatProblem = shownProblems.get(ruleFieldId(idPrefix, 'repeat'));

    return (
        <FullscreenProvider value={isFullscreen}>
            {/* a field that loses focus shows its problem from then on (focusout bubbles to here) */}
            <Box onBlur={(e) => { if (e.target.id) touchAll([e.target.id]); }}>
                {/* Copy From dropdown */}
                {copyFromOptions.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <FormControl size="small" sx={{ minWidth: 250, maxWidth: '100%' }}>
                            <InputLabel shrink>Copy from another {entityType}</InputLabel>
                            <Select
                                inputRef={copySelectRef}
                                inputProps={{ 'aria-label': `Copy from another ${entityType}` }}
                                value=""
                                label={`Copy from another ${entityType}`}
                                onChange={(e) => {
                                    const option = copyFromOptions.find((_, i) => i.toString() === e.target.value);
                                    if (option) handleCopyFrom(option);
                                }}
                                displayEmpty
                                notched
                                startAdornment={<ContentCopy sx={{ mr: 1, color: 'action.active' }} fontSize="small" />}
                                renderValue={() => (
                                    <Typography variant="body2" color="text.secondary">
                                        Select a rule to copy...
                                    </Typography>
                                )}
                            >
                                {copyFromOptions.map((option, index) => (
                                    <MenuItem key={index} value={index.toString()}>
                                        <Box>
                                            <Typography variant="body2">{option.label}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {ENABLE_MODE_LABELS[option.override.mode]}
                                                {option.override.mode === EnableControlMode.CONDITIONAL && option.override.latch && ' (latched)'}
                                            </Typography>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {copyCandidate && (
                            <Box
                                role="group"
                                aria-labelledby={copyQuestionId}
                                data-copy-step=""
                                sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
                            >
                                <Typography id={copyQuestionId} variant="body2">
                                    {COPY_FROM_QUESTION(copyCandidate.label, describeEnableRule(copyCandidate.override).summary)}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1.5 }}>
                                    <Button
                                        color="inherit"
                                        onClick={() => {
                                            focusAfterRender.current = 'copy-select';
                                            setCopyCandidate(null);
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        id={copyReplaceId}
                                        variant="contained"
                                        color="secondary"
                                        onClick={() => {
                                            applyCopy(copyCandidate);
                                            setCopyCandidate(null);
                                            focusAfterRender.current = sentenceId;
                                        }}
                                    >
                                        {BUTTON_NAMES.replaceRule}
                                    </Button>
                                </Box>
                            </Box>
                        )}
                    </Box>
                )}

                <FormControl component="fieldset" fullWidth>
                    <FormLabel component="legend" id={legendId} sx={{ mb: 1 }}>
                        {RULE_COPY.legend(entityType)}
                    </FormLabel>
                    <RadioGroup
                        aria-labelledby={legendId}
                        value={mode}
                        onChange={(e) => setMode(e.target.value as EnableControlMode)}
                    >
                        {MODES.map((m) => {
                            const off = (m === EnableControlMode.CONDITIONAL && conditionalOff) || (m === EnableControlMode.NEVER && neverOff);
                            const problem = modeProblems[m];
                            const captionId = `${idPrefix}-mode-${m}-caption`;
                            return (
                                <FormControlLabel
                                    key={m}
                                    value={m}
                                    disabled={off}
                                    control={
                                        <Radio
                                            id={modeFieldId(idPrefix, m)}
                                            slotProps={{ input: { 'aria-describedby': captionId } }}
                                        />
                                    }
                                    label={
                                        <Box>
                                            <Typography variant="body1">{ENABLE_MODE_LABELS[m]}</Typography>
                                            <Typography
                                                id={captionId}
                                                variant="caption"
                                                color={problem ? 'error' : 'text.secondary'}
                                                sx={{ display: 'block' }}
                                            >
                                                {problem ? problem.text : off ? (m === EnableControlMode.NEVER ? DRILL_NO_NEVER : DRILL_NO_CONDITIONAL) : MODE_DESCRIPTIONS[m]}
                                            </Typography>
                                        </Box>
                                    }
                                    sx={{ mb: 1, alignItems: 'flex-start' }}
                                />
                            );
                        })}
                    </RadioGroup>
                </FormControl>

                {/* the rule in words, and what of it reaches the blueprint: plain text, read when reached */}
                <Box sx={{ mt: 2 }} data-rule-preview="">
                    <Typography variant="caption" color="text.secondary" component="div">{RULE_COPY.sentenceLabel}</Typography>
                    <Typography variant="body1" id={sentenceId} tabIndex={-1} data-rule-sentence="" sx={{ outline: 'none' }}>
                        {sentence}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>{RULE_COPY.blueprintLabel}</Typography>
                    <Typography variant="body2" color="text.secondary" data-rule-blueprint="">
                        {blueprintNoteOf(mode, entityType)}
                    </Typography>
                </Box>

                {/* CLOCKED mode fields */}
                {mode === EnableControlMode.CLOCKED && (
                    <Box sx={{ mt: 3, pl: { xs: 0, sm: 4 } }}>
                        <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                            Wake windows
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-rule-period="">
                            {periodLineOf(timing)}
                        </Typography>

                        {ranges.map((range, index) => {
                            const n = index + 1;
                            const startId = ruleFieldId(idPrefix, 'start', index);
                            const endId = ruleFieldId(idPrefix, 'end', index);
                            const startProblem = shownProblems.get(startId);
                            const endProblem = shownProblems.get(endId);
                            // narrower fields at phone width, and the End field keeps its remove button beside it
                            const fieldSx = { width: { xs: 104, sm: 130 } };
                            return (
                                <Box key={index} sx={{ display: 'flex', gap: { xs: 1, sm: 1.5 }, alignItems: 'flex-start', flexWrap: 'wrap', mb: 1.5 }}>
                                    <TextField
                                        id={startId}
                                        label="Start tick"
                                        type="number"
                                        value={range.start}
                                        onChange={(e) => handleUpdateRange(index, 'start', e.target.value)}
                                        size="small"
                                        sx={fieldSx}
                                        error={startProblem !== undefined}
                                        helperText={startProblem?.text}
                                        slotProps={{ htmlInput: { min: 0, inputMode: 'numeric', 'aria-label': windowFieldName('start', n) } }}
                                    />
                                    <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>to</Typography>
                                    <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1.5 }, alignItems: 'flex-start' }}>
                                        <TextField
                                            id={endId}
                                            label="End tick"
                                            type="number"
                                            value={range.end}
                                            onChange={(e) => handleUpdateRange(index, 'end', e.target.value)}
                                            size="small"
                                            sx={fieldSx}
                                            error={endProblem !== undefined}
                                            helperText={endProblem?.text}
                                            slotProps={{ htmlInput: { min: 0, inputMode: 'numeric', 'aria-label': windowFieldName('end', n) } }}
                                        />
                                        <IconButton
                                            onClick={() => handleRemoveRange(index)}
                                            disabled={ranges.length <= 1}
                                            size="small"
                                            color="error"
                                            aria-label={removeRangeName(n)}
                                            sx={{ mt: 0.5 }}
                                        >
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </Box>
                                </Box>
                            );
                        })}

                        <Button color="inherit" startIcon={<Add />} onClick={handleAddRange} size="small">
                            Add wake window
                        </Button>

                        {planned ? (
                            <Box sx={{ mt: 2 }}>
                                <Button variant="outlined" color="inherit" size="small" onClick={handleUseClockWindows}>
                                    {BUTTON_NAMES.useClockWindows}
                                </Button>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-rule-planned="">
                                    {PLANNED_CAPTION(entityName, planned)}
                                </Typography>
                            </Box>
                        ) : timing.from === 'results' && timing.periodTicks !== null && Number.isInteger(timing.periodTicks) ? (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} data-rule-planned="">
                                {NO_PLANNED_CAPTION(entityName)}
                            </Typography>
                        ) : null}

                        {rulePeriod !== null && (
                            <RulePeriodStrip periodTicks={rulePeriod} windows={stripWindows} reference={reference} />
                        )}

                        <Box sx={{ mt: 3 }}>
                            <TextField
                                id={ruleFieldId(idPrefix, 'repeat')}
                                label={REPEAT_LABEL}
                                type="number"
                                value={periodDuration}
                                onChange={(e) => setPeriodDuration(e.target.value)}
                                size="small"
                                sx={{ width: 240, maxWidth: '100%' }}
                                error={repeatProblem !== undefined}
                                helperText={repeatProblem?.text ?? REPEAT_HELPER(timing.cycleTicks)}
                                slotProps={{ htmlInput: { min: 1, inputMode: 'numeric' } }}
                            />
                            {warnings.map((warning) => (
                                <Box key={warning} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1 }} data-rule-warning="">
                                    <WarningAmber fontSize="small" sx={{ color: 'warning.main' }} aria-hidden />
                                    <Typography variant="body2" color="warning.main">{warning}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}

                {/* CONDITIONAL mode fields */}
                {mode === EnableControlMode.CONDITIONAL && (
                    <Box sx={{ mt: 3, pl: { xs: 0, sm: 2 } }}>
                        {/* the templates read an inserter's ends; a drill's stored Conditional rule gets none */}
                        {entityType === 'inserter' && <QuickTemplateSelect
                            sourceType={sourceType}
                            sinkType={sinkType}
                            movedItems={movedItems}
                            availableItems={availableItems}
                            stackSize={stackSize}
                            ruleSet={ruleSet}
                            latchEnabled={latchEnabled}
                            idPrefix={idPrefix}
                            onApply={handleApplyTemplate}
                        />}

                        <Typography
                            variant="subtitle2"
                            component="h3"
                            id={conditionsHeadingId}
                            tabIndex={-1}
                            sx={{ mb: 2, outline: 'none' }}
                        >
                            Conditions
                        </Typography>

                        <RuleSetEditor
                            ruleSet={ruleSet}
                            onChange={setRuleSet}
                            availableItems={availableItems}
                            sourceType={sourceType}
                            sinkType={sinkType}
                            path="rule"
                            idPrefix={idPrefix}
                            problems={shownProblems}
                        />

                        <LatchConfigEditor
                            enabled={latchEnabled}
                            releaseCondition={releaseCondition}
                            onToggle={setLatchEnabled}
                            onReleaseChange={setReleaseCondition}
                            availableItems={availableItems}
                            sourceType={sourceType}
                            sinkType={sinkType}
                            entityType={entityType}
                            idPrefix={idPrefix}
                            problems={shownProblems}
                        />
                    </Box>
                )}

                {/* Action buttons */}
                {!hideActions && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, pt: 3, mt: 1 }}>
                        <Box>
                            {hasOverride && (
                                <Button onClick={handleClear} color="error">
                                    Clear rule
                                </Button>
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {saveRefused && problems.length > 0 && (
                                <Typography variant="body2" color="error" data-rule-blocked="">
                                    {blockedSummaryOf(problems)}
                                </Typography>
                            )}
                            {onCancel && <Button onClick={onCancel} color="inherit">Cancel</Button>}
                            <Button onClick={handleSave} variant="contained" color="secondary">
                                Save
                            </Button>
                        </Box>
                    </Box>
                )}
            </Box>
        </FullscreenProvider>
    );
}

// ---- Modal wrapper (used by InsertersForm, DrillsForm etc.) ----

function EnableControlModalContent({
    onClose,
    entityType,
    entityId,
    entityLabel,
    currentOverride,
    applyUnchanged = false,
    onSave,
    sourceType,
    sinkType,
    availableItems,
    stackSize,
    movedItems,
    copyFromOptions,
}: Omit<EnableControlModalProps, 'open'>) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [formState, setFormState] = useState<EnableControlFormState | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // Esc and the X ask first when the rule was changed; Cancel is an explicit discard. A Save that changes nothing
    // closes like Cancel, so it does not take ownership of a rule Exclude from LCM forced (`_forced_always`). A mixed
    // bulk selection explicitly applies its initial Auto draft through applyUnchanged.
    const requestClose = () => {
        if (formState?.changed) {
            setConfirmOpen(true);
        } else {
            onClose();
        }
    };

    return (
        <>
            <Dialog
                open
                // it edits an entity by its place in the list, which an Undo could move: it withdraws the offer
                data-edits-build=""
                // a click outside does nothing, so a half-built rule is not lost to a stray click
                onClose={(_event, reason) => {
                    if (reason === 'backdropClick') return;
                    requestClose();
                }}
                maxWidth={isFullscreen ? false : 'md'}
                fullWidth
                fullScreen={isFullscreen}
                // named by the heading and the entity, not by the title bar with its buttons: "Enable rule Inserter 1"
                aria-labelledby="enable-control-title enable-control-entity"
            >
                <DialogTitle component="div" id="enable-control-bar" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Typography variant="h6" component="h2" id="enable-control-title">Enable rule</Typography>
                        <Typography variant="body2" color="text.secondary" id="enable-control-entity">{entityLabel}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexShrink: 0 }}>
                        <Tooltip title={isFullscreen ? BUTTON_NAMES.exitFullscreen : BUTTON_NAMES.fullscreen}>
                            <IconButton
                                onClick={() => setIsFullscreen(!isFullscreen)}
                                aria-label={isFullscreen ? BUTTON_NAMES.exitFullscreen : BUTTON_NAMES.fullscreen}
                            >
                                {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                            </IconButton>
                        </Tooltip>
                        <IconButton onClick={requestClose} edge="end" aria-label={BUTTON_NAMES.close}>
                            <Close />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    <EnableControlFormContent
                        entityType={entityType}
                        entityId={entityId}
                        currentOverride={currentOverride}
                        onSave={(override) => {
                            if (applyUnchanged || enableControlOverrideChanged(override, currentOverride)) onSave(override);
                            onClose();
                        }}
                        onCancel={onClose}
                        onDraftChange={setFormState}
                        isFullscreen={isFullscreen}
                        sourceType={sourceType}
                        sinkType={sinkType}
                        availableItems={availableItems}
                        stackSize={stackSize}
                        movedItems={movedItems}
                        copyFromOptions={copyFromOptions}
                    />
                </DialogContent>
            </Dialog>
            <DiscardChangesDialog
                open={confirmOpen}
                title={`Discard changes to ${entityLabel}'s rule?`}
                onKeepEditing={() => setConfirmOpen(false)}
                onDiscard={() => {
                    setConfirmOpen(false);
                    onClose();
                }}
            />
        </>
    );
}

export function EnableControlModal({ open, ...props }: EnableControlModalProps) {
    if (!open) return null;
    return <EnableControlModalContent {...props} />;
}
