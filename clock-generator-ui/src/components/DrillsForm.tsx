import { Box, Button, TextField, Typography } from '@mui/material';
import { TargetType } from 'clock-generator/light';
import { useState, memo, useMemo } from 'react';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import type { DrillTargetBuild } from '../utils/drillTarget';
import { DrillTargetField } from './DrillTargetField';
import { useEntityRows } from '../hooks/useEntityRows';
import { AddButton, AddRow } from './AddRow';
import { EnableControlFormContent } from './EnableControlModal';
import { EntityRow, EntityRowActions, EntityRowTop } from './EntityRow';
import { EntitySettings } from './EntitySettings';
import { describeEnableRule } from '../utils/enableRuleLabel';
import { enableControlOverrideChanged } from '../utils/enableControlDraft';
import { FactorioIcon } from './FactorioIcon';
import { HelpCommand } from './HelpButton';
import { PanelSection } from './Panel';
import { ItemSelector } from './ItemSelector';
import { SortableList } from './SortableList';
import { entityLabel, settingsSlotId } from '../utils/entityLabel';
import { BUTTON_NAMES, SELECT_NAMES } from '../utils/a11yLabels';
import { useGameNames } from '../hooks/useGameNames';
import { DRILL_TYPES, entityTypeLabel } from './entityTypes';
import { EntityTypeField } from './EntityFields';
import { drillsListed, focusLeaves, speedBonusOfPercent, speedBonusPercent } from '../utils/drillsSection';
import type { OutputTransferSummary } from 'clock-generator/browser';
import { OutputTransferPanel } from './OutputTransferPanel';

const SPEED_BONUS_COMMAND = '/c game.print(game.player.selected.speed_bonus * 100)';
const PRODUCTIVITY_COMMAND = '/c game.print(game.player.selected.productivity_bonus * 100)';

interface DrillsFormProps {
    drills: DrillFormData[];
    resourceNames: string[];
    /** The build's other entities: a drill drops into one of its machines or containers */
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    inserters: InserterFormData[];
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    /** Adds a drill, and turns drills on in the build if they were not */
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<DrillFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onDuplicate: (index: number) => void;
    outputTransfers?: readonly OutputTransferSummary[] | null;
    outputTransfersLoading?: boolean;
}


function DrillRow({ drill, index, count, resourceNames, build, getRecipeInfo, outputTransfer, outputTransfersLoading, onUpdate, onRemove, onDuplicate, onReorder }: Pick<DrillsFormProps, 'resourceNames' | 'getRecipeInfo' | 'onUpdate' | 'onReorder'> & {
    drill: DrillFormData;
    outputTransfer: OutputTransferSummary | null;
    outputTransfersLoading: boolean;
    build: DrillTargetBuild;
    index: number;
    count: number;
    onRemove: (index: number) => void;
    onDuplicate: (index: number) => void;
}) {
    const { itemLabel } = useGameNames();
    const [ruleRevision, setRuleRevision] = useState(0);
    const label = entityLabel('drill', drill.id);
    return <EntityRow kind="drill" row={drill} label={label} icon={<FactorioIcon name={drill.type} size={28} alt="" />}>
        {dragHandle => <>
            <EntityRowTop dragHandle={dragHandle} stackBelow={600} actions={<EntityRowActions kind="drill" id={drill.id} label={label}
                index={index} count={count} onReorder={onReorder} onDuplicate={onDuplicate} onDelete={onRemove} />}>
                <Box data-row-first="">
                    <ItemSelector minWidth={0} dropdownMinWidth={300} sx={{ minWidth: 0, width: '100%' }} value={drill.mined_item_name || ''}
                        onChange={(newValue) => { if (newValue) onUpdate(index, { mined_item_name: newValue }); }}
                        options={resourceNames} label="Mined Resource" />
                </Box>
            </EntityRowTop>
            <DrillTargetField drill={drill} build={build} getRecipeInfo={getRecipeInfo} sx={{ minWidth: 0, width: '100%' }}
                onChange={target => onUpdate(index, { target })} />
            <EntitySettings label={label} actionContainerId={settingsSlotId('drill', drill.id)} summary={openTab => <Box>
                <Typography variant="body2">
                    Mining speed bonus {Number(speedBonusPercent(drill.speed_bonus).toFixed(2))}% · Productivity {Number(drill.productivity.toFixed(2))}% · {describeEnableRule(drill.overrides?.enable_control).chip}
                </Typography>
                {outputTransfer?.results.some(result => result.coverage === 'missing') && <Button color="warning" size="small" onClick={() => openTab('Output Routes')}>Output needs a route</Button>}
                {!outputTransfersLoading && (!outputTransfer || outputTransfer.status === 'unavailable') && <Button color="inherit" size="small" onClick={() => openTab('Output Routes')}>Output routes unavailable</Button>}
            </Box>} tabs={[
                { label: 'Input Routes', content: <Typography variant="body2">This drill mines {itemLabel(drill.mined_item_name) || 'its selected resource'} from the resource patch. No item input connections are configured.</Typography> },
                { label: 'Output Routes', content: <OutputTransferPanel summary={outputTransfer} chests={build.chests}
                    fallbackItems={drill.mined_item_name ? [drill.mined_item_name] : []} loading={outputTransfersLoading} /> },
                { label: 'Machine Facts', content: <Box>
                    <Typography variant="body2">Drill type: {itemLabel(drill.type)}</Typography>
                    <Typography variant="body2">Mined resource: {itemLabel(drill.mined_item_name) || 'Not selected'}</Typography>
                    <Typography variant="body2">Mining speed bonus: {Number(speedBonusPercent(drill.speed_bonus).toFixed(2))}%</Typography>
                    <Typography variant="body2">Productivity: {Number(drill.productivity.toFixed(2))}%</Typography>
                </Box> },
            ]}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, minWidth: 0 }}>
                    <EntityTypeField label="Drill Type" value={drill.type} options={DRILL_TYPES}
                        inputAriaLabel={SELECT_NAMES.drillType} nameOf={value => entityTypeLabel(value, itemLabel)}
                        onChange={type => onUpdate(index, { type: type as DrillFormData['type'] })} sx={{ minWidth: 0, flex: '1 1 200px' }} />
                    <TextField label="Mining speed bonus (%)" type="number" size="small" value={speedBonusPercent(drill.speed_bonus)} inputProps={{ step: 10 }}
                        onChange={(e) => onUpdate(index, { speed_bonus: speedBonusOfPercent(parseFloat(e.target.value) || 0) })} sx={{ minWidth: 0, flex: '1 1 140px' }} />
                    <TextField label="Productivity (%)" type="number" size="small" value={drill.productivity} inputProps={{ min: 0, step: 10 }}
                        onChange={(e) => onUpdate(index, { productivity: Math.max(0, parseFloat(e.target.value) || 0) })} sx={{ minWidth: 0, flex: '1 1 140px' }} />
                </Box>
                <PanelSection level={4} title="Enable control" sx={{ mt: 2 }}><EnableControlFormContent
                    key={ruleRevision + JSON.stringify(drill.overrides?.enable_control)} entityType="drill" entityId={drill.id}
                    currentOverride={drill.overrides?.enable_control} sinkType={drill.target.type === 'chest' ? TargetType.CHEST : TargetType.MACHINE} availableItems={drill.mined_item_name ? [drill.mined_item_name] : []}
                    onCancel={() => setRuleRevision(previous => previous + 1)}
                    onSave={override => {
                        if (enableControlOverrideChanged(override, drill.overrides?.enable_control)) onUpdate(index, { overrides: { ...drill.overrides, enable_control: override } });
                        setRuleRevision(previous => previous + 1);
                    }} /></PanelSection>
            </EntitySettings>
        </>}
    </EntityRow>;
}

/**
 * The build's mining drills. With none, the section is one "Add mining drill" row: a build without drills and one with
 * drills turned off are the same to the generator.
 */
function DrillsFormComponent({
    drills,
    resourceNames,
    machines,
    belts,
    chests,
    inserters,
    getRecipeInfo,
    outputTransfers = null,
    outputTransfersLoading = false,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
    onDuplicate,
}: DrillsFormProps) {

    const build = useMemo(() => ({ machines, belts, chests, inserters, drills }), [machines, belts, chests, inserters, drills]);
    // the row's delete button goes with it: the keyboard moves on to a neighbour's, or to the Add row
    const { cardRef, add: addRow, duplicate, remove } = useEntityRows(drills, { labelOf: drill => entityLabel('drill', drill.id), onRemove, onDuplicate });
    // the section does not fold while the focus is in it: not under a click on its Add button (which a fold before the
    // click would swallow)
    const [focusInSection, setFocusInSection] = useState(false);
    // but deleting the last drill folds it, as before: the focus then goes to the Add row
    const [drillCountBefore, setDrillCountBefore] = useState(drills.length);
    if (drills.length !== drillCountBefore) {
        setDrillCountBefore(drills.length);
        if (drills.length < drillCountBefore) setFocusInSection(false);
    }
    const listed = drillsListed({ drillCount: drills.length, focusInSection });

    const add = () => addRow(onAdd);

    return (
        // the same section in both shapes, so that the focus finds the Add row in it once the last drill goes
        <PanelSection
            ref={cardRef}
            // held open only once listed: focusing the Add row of a folded section does not open it
            onFocus={() => { if (listed) setFocusInSection(true); }}
            onBlur={(event) => { if (focusLeaves(event.currentTarget, event.relatedTarget)) setFocusInSection(false); }}
            level={3}
            title={listed ? `Mining drills (${drills.length})` : 'Mining drills'}
            help={{
                label: BUTTON_NAMES.aboutDrills,
                content: (
                    <>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            To get the mining speed bonus of a drill in Factorio, in percent, hover over the drill and run this command:
                        </Typography>
                        <HelpCommand command={SPEED_BONUS_COMMAND} />
                        <Typography variant="body2" sx={{ my: 1 }}>
                            Its productivity, in percent, is its mining productivity research and its productivity modules together:
                        </Typography>
                        <HelpCommand command={PRODUCTIVITY_COMMAND} />
                    </>
                ),
            }}
            // with none, the Add row below is the one add
            actions={listed && <AddButton label="Add mining drill" onClick={add} />}
        >
            {!listed ? (
                <AddRow label="Add mining drill" data-row-add="" onClick={add} />
            ) : (
                <SortableList itemKeys={drills.map((d) => d._uuid)} onReorder={onReorder}>
                    {drills.map((drill, index) => <DrillRow key={drill._uuid} drill={drill} index={index} count={drills.length} resourceNames={resourceNames}
                        build={build} getRecipeInfo={getRecipeInfo} outputTransfersLoading={outputTransfersLoading}
                        outputTransfer={outputTransfers?.find(transfer => transfer.source.type === 'drill' && transfer.source.id === drill.id) ?? null}
                        onUpdate={onUpdate} onRemove={remove} onDuplicate={duplicate} onReorder={onReorder} />)}
                </SortableList>
            )}

        </PanelSection>
    );
}

export const DrillsForm = memo(DrillsFormComponent);
