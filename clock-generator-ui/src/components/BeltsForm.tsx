import { BeltLanePreview } from './BeltLanePreview';
import { EntitySettings } from './EntitySettings';
import { memo } from 'react';
import { Box, Typography } from '@mui/material';
import { BELT_STRATEGIES, type BeltFormData, type BeltLaneFormData } from '../hooks/useConfigForm';
import { useEntityRows } from '../hooks/useEntityRows';
import { PanelSection } from './Panel';
import { ItemPickerField } from './ItemPickerField';
import { BeltLaneFields, BeltStrategyField, EntityTypeField } from './EntityFields';
import { SortableList } from './SortableList';
import { AddButton } from './AddRow';
import { EntityRow, EntityRowActions, EntityRowTop } from './EntityRow';
import { entityLabel, settingsSlotId } from '../utils/entityLabel';
import { SELECT_NAMES } from '../utils/a11yLabels';
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

    // the row's delete button goes with it: the keyboard moves on to a neighbour's
    const { cardRef, add: addRow, duplicate, remove } = useEntityRows(belts, { labelOf: belt => entityLabel('belt', belt.id), onRemove, onDuplicate });

    return (
        <PanelSection
            ref={cardRef}
            level={4}
            title={`Belts (${belts.length})`}
            help={{
                label: 'About belt strategies',
                content: (
                    <>
                        {(common.length > 0 || lanes.length > 0 && lanes.every(lane => lane.stack_size === lanes[0].stack_size)) && <Typography variant="body2" sx={{ mb: 1 }}>
                            {common.length > 0 && `All ${belts.length} belts: ${common.join(' · ')}. `}
                            {lanes.length > 0 && lanes.every(lane => lane.stack_size === lanes[0].stack_size) && `All ${lanes.length} lanes: stack size ${lanes[0].stack_size}.`}
                        </Typography>}
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
            actions={<AddButton label="Add Belt" onClick={() => addRow(onAdd)} />}
        >
            {beltQuestion.ask && (
                <Box sx={{ mb: 1.5 }}>
                    <BeltAssumption answer={beltQuestion.answer} onChange={onBeltAnswer} />
                </Box>
            )}

            <SortableList itemKeys={belts.map((b) => b._uuid)} onReorder={onReorder}>
            {belts.map((belt, beltIndex) => {
                const label = entityLabel('belt', belt.id);
                const readOnly = geometryBeltIds.includes(belt.id);
                return <EntityRow key={belt._uuid} kind="belt" row={belt} label={label} icon={<BeltLanePreview belt={belt} />}>
                    {dragHandle => <>
                        <EntityRowTop dragHandle={dragHandle} stackBelow={700} actions={<EntityRowActions kind="belt" id={belt.id} label={label}
                            index={beltIndex} count={belts.length} onReorder={onReorder} onDuplicate={duplicate} onDelete={remove} />}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 1.5 }}>
                                <EntityTypeField label="Belt Type" value={belt.type} options={BELT_TYPES} first
                                    readOnly={readOnly} nameOf={value => entityTypeLabel(value, itemLabel)}
                                    inputAriaLabel={`${SELECT_NAMES.beltType}, ${label}`}
                                    onChange={type => onUpdate(beltIndex, { type: type as BeltFormData['type'] })} sx={{ minWidth: 0, width: '100%' }} />
                                {belt.lanes.map((lane, laneIndex) => <ItemPickerField key={laneIndex} value={lane.ingredient || null} options={itemNames}
                                    onChange={value => handleLaneUpdate(beltIndex, laneIndex, 'ingredient', value || '')}
                                    label={`Lane ${laneIndex + 1}`} inputAriaLabel={`Ingredient, ${label}, lane ${laneIndex + 1}`}
                                    readOnly={readOnly} />)}
                            </Box>
                        </EntityRowTop>
                        <EntitySettings actionContainerId={settingsSlotId('belt', belt.id)} label={label} tabs={[{ label: 'Lanes', content:
                            <BeltLaneFields belt={belt} itemNames={itemNames} readOnly={readOnly} onChange={updates => onUpdate(beltIndex, updates)} /> }]}
                            summary={<Typography variant="body2">
                                {BELT_STRATEGIES.find(strategy => strategy.value === (belt.strategy ?? 'normal'))?.label} · {belt.lanes.map((lane, laneIndex) => `Lane ${laneIndex + 1} stack ${lane.stack_size}${belt.strategy === 'export' ? ` · Consumed ${lane.consumption_per_second ?? 'Automatic'}/s` : ''}`).join(' · ')}
                            </Typography>}>
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 1, mb: 1.5 }}>
                                <BeltStrategyField belt={belt} onChange={updates => onUpdate(beltIndex, updates)} />
                            </Box>
                            {readOnly && <Typography variant="body2" sx={{ mb: 1 }}>{DROP_BELT_READ_ONLY}</Typography>}
                        </EntitySettings>
                    </>}
                </EntityRow>;
            })}
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
