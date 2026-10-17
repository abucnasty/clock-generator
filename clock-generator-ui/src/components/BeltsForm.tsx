import { BeltLanePreview } from './BeltLanePreview';
import { EntityBadge } from './EntityBadge';
import { EntitySettings } from './EntitySettings';
import { memo } from 'react';
import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Tooltip,
    Typography,
} from '@mui/material';
import { BELT_FORM_DEFAULT_STACK_SIZE, BELT_STRATEGIES, LANE_CONSUMPTION_TOOLTIP, beltStrategyUpdate, type BeltFormData, type BeltLaneFormData, type BeltStrategyFormValue } from '../hooks/useConfigForm';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { FactorioIcon } from './FactorioIcon';
import { PanelSection } from './Panel';
import { ItemPickerField } from './ItemPickerField';
import { NumberField } from './NumberField';
import { SortableItem, SortableList } from './SortableList';
import { RowActionsMenu } from './RowActionsMenu';
import { useAnnounce } from '../hooks/useMessages';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
import { SELECT_NAMES, deleteLaneName } from '../utils/a11yLabels';
import { useGameNames } from '../hooks/useGameNames';
import { BELT_TYPES, entityTypeLabel } from './entityTypes';
import { BeltAssumption } from './BeltAssumption';
import type { BeltAnswer, BeltQuestion } from '../utils/beltQuestion';
import { DROP_BELT_READ_ONLY } from '../utils/inserterMetadata';

interface BeltsFormProps {
    geometryBeltIds?: number[];
    belts: BeltFormData[];
    itemNames: string[];
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<BeltFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onDuplicate: (index: number) => void;
    /** Asked when an inserter takes from one of these belts */
    beltQuestion: BeltQuestion;
    onBeltAnswer: (answer: BeltAnswer) => void;
}

function BeltsFormComponent({
    geometryBeltIds = [],
    belts,
    itemNames,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
    onDuplicate,
    beltQuestion,
    onBeltAnswer,
}: BeltsFormProps) {
    const { itemLabel } = useGameNames();
    const { density } = useDisplayPreferences();
    const compact = density === 'compact';
    const lanes = belts.flatMap(belt => belt.lanes);
    const common = belts.length === 0 ? [] : [
        belts.every(belt => belt.type === belts[0].type) ? entityTypeLabel(belts[0].type, itemLabel) : null,
        belts.every(belt => (belt.strategy ?? 'normal') === (belts[0].strategy ?? 'normal')) ? `${BELT_STRATEGIES.find(strategy => strategy.value === (belts[0].strategy ?? 'normal'))?.label} strategy` : null,
    ].filter(Boolean);

    const handleLaneUpdate = (
        beltIndex: number,
        laneIndex: number,
        field: keyof BeltLaneFormData,
        value: string | number | undefined
    ) => {
        const belt = belts[beltIndex];
        const newLanes = [...belt.lanes] as [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData];
        newLanes[laneIndex] = { ...newLanes[laneIndex], [field]: value };
        onUpdate(beltIndex, { lanes: newLanes });
    };

    const addLane = (beltIndex: number) => {
        const belt = belts[beltIndex];
        if (belt.lanes.length < 2) {
            const newLanes: [BeltLaneFormData, BeltLaneFormData] = [
                belt.lanes[0],
                { ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE },
            ];
            onUpdate(beltIndex, { lanes: newLanes });
        }
    };

    const removeLane = (beltIndex: number) => {
        const belt = belts[beltIndex];
        if (belt.lanes.length > 1) {
            const newLanes: [BeltLaneFormData] = [belt.lanes[0]];
            onUpdate(beltIndex, { lanes: newLanes });
        }
    };

    // the row's delete button goes with it: the keyboard moves on to a neighbour's
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(belts.length, onRemove);
    const announce = useAnnounce();
    const addedLabel = () => entityLabel('belt', Math.max(0, ...belts.map(row => row.id)) + 1);
    const duplicate = (index: number) => {
        afterAdd(() => onDuplicate(index));
        announce(`Added ${addedLabel()}, a copy of ${entityLabel('belt', belts[index].id)}.`);
    };

    const add = () => {
        afterAdd(onAdd);
        announce(`Added ${addedLabel()}.`);
    };

    return (
        <PanelSection
            ref={cardRef}
            level={4}
            title={`Belts (${belts.length})`}
            help={{
                label: 'About belt strategies',
                content: (
                    <>
                        {BELT_STRATEGIES.map((strategy) => (
                            <Typography key={strategy.value} variant="body2" sx={{ mb: 1 }}>
                                <strong>{strategy.label}:</strong> {strategy.description}
                            </Typography>
                        ))}
                        <Typography variant="body2" color="text.secondary">
                            Inserters putting items onto a belt are clocked for what the inserters in this build take off
                            it. Use an export belt when machines outside this build take items off it too.
                        </Typography>
                    </>
                ),
            }}
            actions={(
                <Button startIcon={<Add />} onClick={add} variant="text" size="small" data-row-add="">
                    Add Belt
                </Button>
            )}
        >

            {beltQuestion.ask && (
                <Box sx={{ mb: 1.5 }}>
                    <BeltAssumption answer={beltQuestion.answer} onChange={onBeltAnswer} />
                </Box>
            )}

            {!compact && (common.length > 0 || lanes.length > 0 && lanes.every(lane => lane.stack_size === lanes[0].stack_size)) && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {common.length > 0 && `All ${belts.length} belts: ${common.join(' · ')}. `}
                {lanes.length > 0 && lanes.every(lane => lane.stack_size === lanes[0].stack_size) && `All ${lanes.length} lanes: stack size ${lanes[0].stack_size}.`}
            </Typography>}
            <SortableList itemKeys={belts.map((b) => b._uuid)} onReorder={onReorder}>
            {belts.map((belt, beltIndex) => (
                <SortableItem key={belt._uuid} stableKey={belt._uuid} label={entityLabel('belt', belt.id)} displayLabel={<EntityBadge id={belt.id}><BeltLanePreview belt={belt} /></EntityBadge>}>
                    {(dragHandle) => (
                <Box
                    id={`entity-belt-${belt.id}`}
                    role="group"
                    aria-label={entityLabel('belt', belt.id)}
                    sx={{
                        mb: compact ? 1 : 2,
                        p: compact ? 1.5 : 2,
                        minWidth: 0,
                        containerType: 'inline-size',
                        containerName: 'belt-row',
                        bgcolor: (theme: Theme) => themeTokens(theme).surface.row,
                    }}
                >
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 1.5, alignItems: 'center', '@container belt-row (max-width: 700px)': { gridTemplateColumns: 'minmax(0, 1fr) auto' } }}>
                        <Box sx={{ gridColumn: 1, gridRow: 1 }}>{dragHandle}</Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 1.5, minWidth: 0, gridColumn: 2, gridRow: 1, '@container belt-row (max-width: 700px)': { gridColumn: '1 / -1', gridRow: 2 } }}>
                        <FormControl data-row-first="" size="small" sx={{ minWidth: 0, width: '100%' }}>
                            <InputLabel>Belt Type</InputLabel>
                            <Select
                                readOnly={geometryBeltIds.includes(belt.id)}
                                inputProps={{ 'aria-label': `${SELECT_NAMES.beltType}, ${entityLabel('belt', belt.id)}` }}
                                value={belt.type}
                                label="Belt Type"
                                onChange={(e) =>
                                    onUpdate(beltIndex, {
                                        type: e.target.value as BeltFormData['type'],
                                    })
                                }
                                renderValue={(selected) => (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <FactorioIcon name={selected} size={20} alt="" />
                                        {entityTypeLabel(selected, itemLabel)}
                                    </Box>
                                )}
                            >
                                {BELT_TYPES.map((bt) => (
                                    <MenuItem key={bt.value} value={bt.value}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <FactorioIcon name={bt.value} size={20} alt="" />
                                            {entityTypeLabel(bt.value, itemLabel)}
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                            {belt.lanes.map((lane, laneIndex) => <ItemPickerField key={laneIndex} value={lane.ingredient || null} options={itemNames}
                                onChange={value => handleLaneUpdate(beltIndex, laneIndex, 'ingredient', value || '')}
                                label={`Lane ${laneIndex + 1}`} inputAriaLabel={`Ingredient, ${entityLabel('belt', belt.id)}, lane ${laneIndex + 1}`}
                                readOnly={geometryBeltIds.includes(belt.id)} />)}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gridColumn: 3, gridRow: 1, '@container belt-row (max-width: 700px)': { gridColumn: 2 } }}>
                            <Box id={`settings-actions-belt-${belt.id}`} sx={{ display: 'flex' }} />
                            <RowActionsMenu label={entityLabel('belt', belt.id)} onDuplicate={() => duplicate(beltIndex)}
                                onMoveUp={beltIndex > 0 ? () => onReorder(beltIndex, beltIndex - 1) : undefined}
                                onMoveDown={beltIndex < belts.length - 1 ? () => onReorder(beltIndex, beltIndex + 1) : undefined} />
                            <IconButton onClick={() => remove(beltIndex)} color="error" aria-label={deleteButtonLabel('belt', belt.id)} data-row-delete="">
                                <Delete />
                            </IconButton>
                        </Box>
                    <EntitySettings actionContainerId={`settings-actions-belt-${belt.id}`} label={entityLabel('belt', belt.id)} tabs={[{ label: 'Lanes', content: (<>
                    {/* Lanes */}
                    <Box sx={{ pl: compact ? 0 : { xs: 0, sm: 2 }, minWidth: 0 }}>
                        {!geometryBeltIds.includes(belt.id) && belt.lanes.length < 2 && (
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                                <Button size="small" onClick={() => addLane(beltIndex)}>Add Lane</Button>
                            </Box>
                        )}
                        {belt.lanes.map((lane, laneIndex) => (
                            <Box
                                key={`lane-${laneIndex}`}
                                sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px', gap: 1, alignItems: 'start', mb: 1, minWidth: 0 }}
                            >
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 1 : 2, rowGap: 1, alignItems: 'center', minWidth: 0 }}>
                                <Typography variant="body2" sx={{ width: 60, flexShrink: 0 }}>
                                    Lane {laneIndex + 1}:
                                </Typography>
                                {geometryBeltIds.includes(belt.id) ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Ingredient: {itemLabel(lane.ingredient)}. Stack size: {lane.stack_size} (read-only).</Typography> : <>
                                <NumberField
                                    label="Stack size"
                                    value={lane.stack_size}
                                    onValueChange={(val) => {
                                        const integer = parseInt(val?.toString() || '');
                                        handleLaneUpdate(
                                            beltIndex,
                                            laneIndex,
                                            'stack_size',
                                            integer || BELT_FORM_DEFAULT_STACK_SIZE
                                        )
                                    }}
                                    min={1}
                                    sx={{ width: 100, minWidth: 100, flexShrink: 0 }}
                                    size="small"
                                />
                                </>}
                                {belt.strategy === 'export' && (
                                <Tooltip title={LANE_CONSUMPTION_TOOLTIP} describeChild>
                                    <Box sx={{ flexShrink: 0 }}>
                                        <NumberField
                                            label="Consumed /s"
                                            value={lane.consumption_per_second ?? null}
                                            onValueChange={(val) =>
                                                handleLaneUpdate(beltIndex, laneIndex, 'consumption_per_second', val && val > 0 ? val : undefined)
                                            }
                                            min={0}
                                            sx={{ width: 120, minWidth: 120 }}
                                            size="small"
                                        />
                                    </Box>
                                </Tooltip>
                                )}
                                </Box>
                                {!geometryBeltIds.includes(belt.id) && belt.lanes.length > 1 ? (
                                    laneIndex === 1 ? (
                                        <IconButton
                                            size="small"
                                            onClick={() => removeLane(beltIndex)}
                                            color="error"
                                            aria-label={deleteLaneName(entityLabel('belt', belt.id), laneIndex + 1)}
                                        >
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    ) : (
                                        <Box sx={{ width: 28, flexShrink: 0 }} />
                                    )
                                ) : null}
                            </Box>
                        ))}
                    </Box>
</>) }]} summary={<Typography variant="body2">
                        {BELT_STRATEGIES.find(strategy => strategy.value === (belt.strategy ?? 'normal'))?.label} · {belt.lanes.map((lane, laneIndex) => `Lane ${laneIndex + 1} stack ${lane.stack_size}${belt.strategy === 'export' ? ` · Consumed ${lane.consumption_per_second ?? 'Automatic'}/s` : ''}`).join(' · ')}
                    </Typography>}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: compact ? 1 : 2, mb: 1.5 }}>

                        <FormControl size="small" sx={{ minWidth: 0, width: '100%' }}>
                            <InputLabel>Strategy</InputLabel>
                            <Select
                                inputProps={{ 'aria-label': `${SELECT_NAMES.beltStrategy}, ${entityLabel('belt', belt.id)}` }}
                                value={belt.strategy ?? 'normal'}
                                label="Strategy"
                                onChange={(e) =>
                                    onUpdate(beltIndex, beltStrategyUpdate(belt, e.target.value as BeltStrategyFormValue))
                                }
                            >
                                {BELT_STRATEGIES.map((strategy) => (
                                    <MenuItem key={strategy.value} value={strategy.value}>
                                        <Tooltip title={strategy.description} placement="right" describeChild>
                                            <span>{strategy.label}</span>
                                        </Tooltip>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    {geometryBeltIds.includes(belt.id) && <Typography variant="body2" sx={{ mb: 1 }}>{DROP_BELT_READ_ONLY}</Typography>}


                    </EntitySettings>
                    </Box>
                </Box>
                    )}
                </SortableItem>
            ))}
            </SortableList>

            {belts.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    No belts configured.
                </Typography>
            )}
        </PanelSection>
    );
}

export const BeltsForm = memo(BeltsFormComponent);
