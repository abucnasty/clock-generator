import { Add, Close, ContentCopy, Delete, Fullscreen, FullscreenExit } from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
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
import { useLayoutEffect, useMemo, useState } from 'react';
import type { EnableControlOverride, EnableControlRange, RuleSet } from '../hooks/useConfigForm';
import {
    buildEnableControlOverride,
    enableControlDraftChanged,
    enableControlDraftOf,
    enableControlOverrideChanged,
} from '../utils/enableControlDraft';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { RuleSetEditor } from './RuleSetEditor';
import { createDefaultRuleSet } from './ruleSetUtils';
import { FullscreenProvider } from './FullscreenContext';
import { LatchConfigEditor } from './LatchConfigEditor';
import { QuickTemplateSelect } from './QuickTemplateSelect';

export interface CopyFromOption {
    label: string;
    override: EnableControlOverride;
}

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface EnableControlModalProps {
    open: boolean;
    onClose: () => void;
    entityType: 'inserter' | 'drill';
    entityLabel: string;
    currentOverride?: EnableControlOverride;
    onSave: (override: EnableControlOverride | undefined) => void;
    sourceType?: SourceSinkType;
    sinkType?: SourceSinkType;
    availableItems?: string[];
    /** Other entities with configured overrides that can be copied from */
    copyFromOptions?: CopyFromOption[];
}

const MODE_DESCRIPTIONS: Record<EnableControlMode, string> = {
    [EnableControlMode.AUTO]: 'Use automatic control logic (default behavior)',
    [EnableControlMode.ALWAYS]: 'Entity is always enabled, with no combinator in the blueprint',
    [EnableControlMode.NEVER]: 'Entity is never enabled',
    [EnableControlMode.CLOCKED]: 'Entity is enabled during specified tick ranges',
    [EnableControlMode.CONDITIONAL]: 'Entity is enabled based on custom conditions',
};

// ---- Exported standalone form (no Dialog wrapper) ----

/** What the rule form would save, and whether that differs from what it was opened with */
export interface EnableControlFormState {
    override: EnableControlOverride | undefined;
    changed: boolean;
}

interface EnableControlFormContentProps {
    entityType: 'inserter' | 'drill';
    currentOverride?: EnableControlOverride;
    /** Not called when `hideActions` is set, as there is no Save button then */
    onSave?: (override: EnableControlOverride | undefined) => void;
    onCancel?: () => void;
    /** Told what the form would save, as it changes; pass a stable function (a state setter) */
    onDraftChange?: (state: EnableControlFormState) => void;
    /** Hides Clear Override, Cancel and Save, for a host with a Save of its own */
    hideActions?: boolean;
    isFullscreen?: boolean;
    sourceType?: SourceSinkType;
    sinkType?: SourceSinkType;
    availableItems?: string[];
    copyFromOptions?: CopyFromOption[];
}

export function EnableControlFormContent({
    entityType,
    currentOverride,
    onSave,
    onCancel,
    onDraftChange,
    hideActions = false,
    isFullscreen = false,
    sourceType = TargetType.MACHINE,
    sinkType = TargetType.MACHINE,
    availableItems = [],
    copyFromOptions = [],
}: EnableControlFormContentProps) {
    // Initialize state from currentOverride, once: what the form was opened with
    const [initial] = useState(() => enableControlDraftOf(currentOverride));

    const [mode, setMode] = useState<EnableControlMode>(initial.mode);
    const [ranges, setRanges] = useState<EnableControlRange[]>(initial.ranges);
    const [periodDuration, setPeriodDuration] = useState<string>(initial.periodDuration);
    const [ruleSet, setRuleSet] = useState<RuleSet>(initial.ruleSet);
    const [latchEnabled, setLatchEnabled] = useState<boolean>(initial.latchEnabled);
    const [releaseCondition, setReleaseCondition] = useState<RuleSet | undefined>(initial.releaseCondition);

    // the rule the form would save, and whether it differs from the one it was opened with
    const draft = useMemo(
        () => ({ mode, ranges, periodDuration, ruleSet, latchEnabled, releaseCondition }),
        [mode, ranges, periodDuration, ruleSet, latchEnabled, releaseCondition],
    );
    const override = useMemo(() => buildEnableControlOverride(draft), [draft]);
    const changed = useMemo(() => enableControlDraftChanged(draft, initial), [draft, initial]);

    // a layout effect, so that the host knows of a change before it handles the next key (an Esc right after a click)
    useLayoutEffect(() => {
        onDraftChange?.({ override, changed });
    }, [override, changed, onDraftChange]);

    const handleAddRange = () => {
        const lastRange = ranges[ranges.length - 1];
        const newStart = lastRange ? lastRange.end + 50 : 0;
        setRanges([...ranges, { start: newStart, end: newStart + 100 }]);
    };

    const handleRemoveRange = (index: number) => {
        if (ranges.length > 1) {
            setRanges(ranges.filter((_, i) => i !== index));
        }
    };

    const handleUpdateRange = (index: number, field: 'start' | 'end', value: number) => {
        setRanges(ranges.map((range, i) => 
            i === index ? { ...range, [field]: value } : range
        ));
    };

    const handleSave = () => {
        onSave?.(override);
    };

    const handleApplyTemplate = (templateRuleSet: RuleSet, templateRelease?: RuleSet) => {
        setRuleSet(templateRuleSet);
        if (templateRelease) {
            setLatchEnabled(true);
            setReleaseCondition(templateRelease);
        } else {
            setLatchEnabled(false);
            setReleaseCondition(undefined);
        }
    };

    const handleCopyFrom = (option: CopyFromOption) => {
        const override = option.override;
        setMode(override.mode);
        
        if (override.mode === EnableControlMode.CLOCKED) {
            setRanges(override.ranges || [{ start: 0, end: 100 }]);
            setPeriodDuration(override.period_duration_ticks?.toString() || '');
        } else if (override.mode === EnableControlMode.CONDITIONAL) {
            setRuleSet(override.rule_set || createDefaultRuleSet());
            setLatchEnabled(!!override.latch);
            setReleaseCondition(override.latch?.release);
        }
    };

    const handleClear = () => {
        onSave?.(undefined);
    };

    const hasOverride = currentOverride && currentOverride.mode !== EnableControlMode.AUTO;

    return (
        <FullscreenProvider value={isFullscreen}>
            <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Configure when this {entityType} should be enabled during the crafting cycle.
                </Typography>

                {/* Copy From dropdown */}
                {copyFromOptions.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <FormControl size="small" sx={{ minWidth: 250 }}>
                            <InputLabel shrink>Copy from another {entityType}</InputLabel>
                            <Select
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
                                        Select to copy configuration...
                                    </Typography>
                                )}
                            >
                                {copyFromOptions.map((option, index) => (
                                    <MenuItem key={index} value={index.toString()}>
                                        <Box>
                                            <Typography variant="body2">{option.label}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {option.override.mode}
                                                {option.override.mode === EnableControlMode.CONDITIONAL && option.override.latch && ' (latched)'}
                                            </Typography>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                )}

                <FormControl component="fieldset" fullWidth>
                    <RadioGroup
                        value={mode}
                        onChange={(e) => setMode(e.target.value as EnableControlMode)}
                    >
                        {([EnableControlMode.AUTO, EnableControlMode.ALWAYS, EnableControlMode.NEVER, EnableControlMode.CLOCKED, EnableControlMode.CONDITIONAL] as EnableControlMode[]).map((m) => (
                            <FormControlLabel
                                key={m}
                                value={m}
                                control={<Radio />}
                                label={
                                    <Box>
                                        <Typography variant="body1">{m}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {MODE_DESCRIPTIONS[m]}
                                        </Typography>
                                    </Box>
                                }
                                sx={{ mb: 1, alignItems: 'flex-start' }}
                            />
                        ))}
                    </RadioGroup>
                </FormControl>

                {/* CLOCKED mode configuration */}
                {mode === EnableControlMode.CLOCKED && (
                    <Box sx={{ mt: 3, pl: 4 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2 }}>
                            Enable Ranges
                        </Typography>

                        {ranges.map((range, index) => (
                            <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1 }}>
                                <TextField
                                    label="Start Tick"
                                    type="number"
                                    value={range.start}
                                    onChange={(e) => handleUpdateRange(index, 'start', parseInt(e.target.value) || 0)}
                                    size="small"
                                    sx={{ width: 120 }}
                                    inputProps={{ min: 0 }}
                                />
                                <Typography variant="body2" color="text.secondary">to</Typography>
                                <TextField
                                    label="End Tick"
                                    type="number"
                                    value={range.end}
                                    onChange={(e) => handleUpdateRange(index, 'end', parseInt(e.target.value) || 0)}
                                    size="small"
                                    sx={{ width: 120 }}
                                    inputProps={{ min: 1 }}
                                />
                                <IconButton
                                    onClick={() => handleRemoveRange(index)}
                                    disabled={ranges.length <= 1}
                                    size="small"
                                    color="error"
                                >
                                    <Delete fontSize="small" />
                                </IconButton>
                            </Box>
                        ))}

                        <Button startIcon={<Add />} onClick={handleAddRange} size="small" sx={{ mt: 1 }}>
                            Add Range
                        </Button>

                        <Box sx={{ mt: 3 }}>
                            <TextField
                                label="Period Duration (ticks)"
                                type="number"
                                value={periodDuration}
                                onChange={(e) => setPeriodDuration(e.target.value)}
                                size="small"
                                sx={{ width: 200 }}
                                inputProps={{ min: 1 }}
                                helperText="Optional. Defaults to crafting cycle duration."
                            />
                        </Box>
                    </Box>
                )}

                {/* CONDITIONAL mode configuration */}
                {mode === EnableControlMode.CONDITIONAL && (
                    <Box sx={{ mt: 3, pl: 2 }}>
                        <QuickTemplateSelect
                            onApply={handleApplyTemplate}
                            defaultItemName={availableItems[0] || ''}
                        />

                        <Typography variant="subtitle2" sx={{ mb: 2 }}>
                            Conditions
                        </Typography>

                        <RuleSetEditor
                            ruleSet={ruleSet}
                            onChange={setRuleSet}
                            availableItems={availableItems}
                            sourceType={sourceType}
                            sinkType={sinkType}
                        />

                        <LatchConfigEditor
                            enabled={latchEnabled}
                            releaseCondition={releaseCondition}
                            onToggle={setLatchEnabled}
                            onReleaseChange={setReleaseCondition}
                            availableItems={availableItems}
                            sourceType={sourceType}
                            sinkType={sinkType}
                        />
                    </Box>
                )}

                {/* Action buttons */}
                {!hideActions && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 3, mt: 1 }}>
                        <Box>
                            {hasOverride && (
                                <Button onClick={handleClear} color="error">
                                    Clear Override
                                </Button>
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            {onCancel && <Button onClick={onCancel}>Cancel</Button>}
                            <Button onClick={handleSave} variant="contained" color="primary">
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
    entityLabel,
    currentOverride,
    onSave,
    sourceType,
    sinkType,
    availableItems,
    copyFromOptions,
}: Omit<EnableControlModalProps, 'open'>) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [formState, setFormState] = useState<EnableControlFormState | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // Esc and the X ask first when the rule was changed; Cancel is an explicit discard. A Save that changes nothing
    // closes like Cancel, so it does not take ownership of a rule Exclude from LCM forced (`_forced_always`).
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
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Typography variant="h6">Enable Control Override</Typography>
                        <Typography variant="body2" color="text.secondary">{entityLabel}</Typography>
                    </Box>
                    <Box>
                        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                            <IconButton onClick={() => setIsFullscreen(!isFullscreen)}>
                                {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                            </IconButton>
                        </Tooltip>
                        <IconButton onClick={requestClose} edge="end">
                            <Close />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    <EnableControlFormContent
                        entityType={entityType}
                        currentOverride={currentOverride}
                        onSave={(override) => {
                            if (enableControlOverrideChanged(override, currentOverride)) onSave(override);
                            onClose();
                        }}
                        onCancel={onClose}
                        onDraftChange={setFormState}
                        isFullscreen={isFullscreen}
                        sourceType={sourceType}
                        sinkType={sinkType}
                        availableItems={availableItems}
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
