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
import { EnableControlMode, TargetType } from 'clock-generator/browser';
import { useState } from 'react';
import type { EnableControlOverride, EnableControlRange, RuleSet } from '../hooks/useConfigForm';
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
    [EnableControlMode.ALWAYS]: 'Entity is always enabled',
    [EnableControlMode.NEVER]: 'Entity is never enabled',
    [EnableControlMode.CLOCKED]: 'Entity is enabled during specified tick ranges',
    [EnableControlMode.CONDITIONAL]: 'Entity is enabled based on custom conditions',
};

// ---- Exported standalone form (no Dialog wrapper) ----

export interface EnableControlFormContentProps {
    entityType: 'inserter' | 'drill';
    currentOverride?: EnableControlOverride;
    onSave: (override: EnableControlOverride | undefined) => void;
    onCancel?: () => void;
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
    isFullscreen = false,
    sourceType = TargetType.MACHINE,
    sinkType = TargetType.MACHINE,
    availableItems = [],
    copyFromOptions = [],
}: EnableControlFormContentProps) {
    // Initialize state from currentOverride
    const initialMode = currentOverride?.mode ?? EnableControlMode.AUTO;
    const initialRanges = (currentOverride?.mode === EnableControlMode.CLOCKED && currentOverride?.ranges) 
        ? currentOverride.ranges 
        : [{ start: 0, end: 100 }];
    const initialPeriodDuration = 
        (currentOverride?.mode === EnableControlMode.CLOCKED ? currentOverride?.period_duration_ticks?.toString() : '') ?? '';
    const initialRuleSet = (currentOverride?.mode === EnableControlMode.CONDITIONAL && currentOverride?.rule_set) 
        ? currentOverride.rule_set 
        : createDefaultRuleSet();
    const initialLatchEnabled = !!(currentOverride?.mode === EnableControlMode.CONDITIONAL && currentOverride?.latch);
    const initialReleaseCondition = (currentOverride?.mode === EnableControlMode.CONDITIONAL && currentOverride?.latch?.release) 
        ? currentOverride.latch.release 
        : undefined;

    const [mode, setMode] = useState<EnableControlMode>(initialMode);
    const [ranges, setRanges] = useState<EnableControlRange[]>(initialRanges);
    const [periodDuration, setPeriodDuration] = useState<string>(initialPeriodDuration);
    const [ruleSet, setRuleSet] = useState<RuleSet>(initialRuleSet);
    const [latchEnabled, setLatchEnabled] = useState<boolean>(initialLatchEnabled);
    const [releaseCondition, setReleaseCondition] = useState<RuleSet | undefined>(initialReleaseCondition);

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
        if (mode === EnableControlMode.AUTO) {
            onSave(undefined);
        } else if (mode === EnableControlMode.CLOCKED) {
            const override: EnableControlOverride = {
                mode: EnableControlMode.CLOCKED,
                ranges: ranges.filter(r => r.end > r.start),
            };
            if (periodDuration && parseInt(periodDuration) > 0) {
                override.period_duration_ticks = parseInt(periodDuration);
            }
            onSave(override);
        } else if (mode === EnableControlMode.CONDITIONAL) {
            const override: EnableControlOverride = {
                mode: EnableControlMode.CONDITIONAL,
                rule_set: ruleSet,
                latch: latchEnabled && releaseCondition ? {
                    release: releaseCondition,
                } : undefined,
            };
            onSave(override);
        } else if (mode === EnableControlMode.ALWAYS) {
            onSave({ mode: EnableControlMode.ALWAYS });
        } else if (mode === EnableControlMode.NEVER) {
            onSave({ mode: EnableControlMode.NEVER });
        }
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
        onSave(undefined);
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

    return (
        <Dialog
            open
            onClose={onClose}
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
                    <IconButton onClick={onClose} edge="end">
                        <Close />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers>
                <EnableControlFormContent
                    entityType={entityType}
                    currentOverride={currentOverride}
                    onSave={(override) => { onSave(override); onClose(); }}
                    onCancel={onClose}
                    isFullscreen={isFullscreen}
                    sourceType={sourceType}
                    sinkType={sinkType}
                    availableItems={availableItems}
                    copyFromOptions={copyFromOptions}
                />
            </DialogContent>
        </Dialog>
    );
}

export function EnableControlModal({ open, ...props }: EnableControlModalProps) {
    if (!open) return null;
    return <EnableControlModalContent {...props} />;
}
