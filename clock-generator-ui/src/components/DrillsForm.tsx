import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    IconButton,
    TextField,
    Typography,
} from '@mui/material';
import { TargetType } from 'clock-generator/light';
import { useState, memo, useMemo } from 'react';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import type { DrillTargetBuild } from '../utils/drillTarget';
import { DrillTargetField } from './DrillTargetField';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { AddRow } from './AddRow';
import { EnableControlFormContent } from './EnableControlModal';
import { EntityBadge } from './EntityBadge';
import { EntitySettings } from './EntitySettings';
import { describeEnableRule } from '../utils/enableRuleLabel';
import { enableControlOverrideChanged } from '../utils/enableControlDraft';
import { FactorioIcon } from './FactorioIcon';
import { HelpCommand } from './HelpButton';
import { PanelSection } from './Panel';
import { ItemSelector } from './ItemSelector';
import { SortableItem, SortableList } from './SortableList';
import { RowActionsMenu } from './RowActionsMenu';
import { useAnnounce } from '../hooks/useMessages';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
import { BUTTON_NAMES, SELECT_NAMES } from '../utils/a11yLabels';
import { useGameNames } from '../hooks/useGameNames';
import { DRILL_TYPES, entityTypeLabel } from './entityTypes';
import { EntityTypeField } from './EntityFields';
import { drillsListed, focusLeaves, speedBonusOfPercent, speedBonusPercent } from '../utils/drillsSection';

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
}


function DrillRow({ drill, index, resourceNames, build, getRecipeInfo, onUpdate, onRemove, onDuplicate, onMoveUp, onMoveDown }: Pick<DrillsFormProps, 'resourceNames' | 'getRecipeInfo' | 'onUpdate'> & {
    drill: DrillFormData;
    build: DrillTargetBuild;
    index: number;
    onRemove: (index: number) => void;
    onDuplicate: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
}) {
    const { itemLabel } = useGameNames();
    const [ruleRevision, setRuleRevision] = useState(0);
    const label = entityLabel('drill', drill.id);
    return <SortableItem stableKey={drill._uuid} label={label} displayLabel={<EntityBadge id={drill.id}><FactorioIcon name={drill.type} size={28} alt="" /></EntityBadge>}>
        {dragHandle => <Box id={`entity-drill-${drill.id}`} role="group" aria-label={label} sx={{ minWidth: 0, mb: 1, p: 1.5, containerType: 'inline-size', containerName: 'drill-row', bgcolor: (theme: Theme) => themeTokens(theme).surface.row }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) auto', gap: 1.5, alignItems: 'center', '@container drill-row (max-width: 600px)': { gridTemplateColumns: 'minmax(0, 1fr) auto' } }}>
                <Box sx={{ gridColumn: 1, gridRow: 1 }}>{dragHandle}</Box>
                <Box data-row-first="" sx={{ minWidth: 0, gridColumn: 2, gridRow: 1, '@container drill-row (max-width: 600px)': { gridColumn: '1 / -1', gridRow: 2 } }}>
                            <ItemSelector
                                minWidth={0}
                                dropdownMinWidth={300}
                                sx={{ minWidth: 0, width: '100%' }}
                                value={drill.mined_item_name || ''}
                                onChange={(newValue) => {
                                    if (newValue) {
                                        onUpdate(index, { mined_item_name: newValue });
                                    }
                                }}
                                options={resourceNames}
                                label="Mined Resource"
                            />

                </Box>
                <Box sx={{ minWidth: 0, gridColumn: 3, gridRow: 1, '@container drill-row (max-width: 600px)': { gridColumn: '1 / -1', gridRow: 3 } }}>
                            <DrillTargetField drill={drill} build={build} getRecipeInfo={getRecipeInfo} sx={{ minWidth: 0, width: '100%' }}
                                onChange={target => onUpdate(index, { target })} />

                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gridColumn: 4, gridRow: 1, '@container drill-row (max-width: 600px)': { gridColumn: 2 } }}>
                    <Box id={`settings-actions-drill-${drill.id}`} sx={{ display: 'flex' }} />
                    <RowActionsMenu label={label} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
                    <IconButton onClick={() => onRemove(index)} color="error" aria-label={deleteButtonLabel('drill', drill.id)} data-row-delete=""><Delete /></IconButton>
                </Box>
                <EntitySettings label={label} actionContainerId={`settings-actions-drill-${drill.id}`} summary={<Typography variant="body2">
                    Mining speed bonus {Number(speedBonusPercent(drill.speed_bonus).toFixed(2))}% · Productivity {Number(drill.productivity.toFixed(2))}% · {describeEnableRule(drill.overrides?.enable_control).chip}
                </Typography>} tabs={[{ label: 'Enable control', content: <EnableControlFormContent
                    key={ruleRevision + JSON.stringify(drill.overrides?.enable_control)} entityType="drill" entityId={drill.id}
                    currentOverride={drill.overrides?.enable_control} sinkType={drill.target.type === 'chest' ? TargetType.CHEST : TargetType.MACHINE} availableItems={drill.mined_item_name ? [drill.mined_item_name] : []}
                    onCancel={() => setRuleRevision(previous => previous + 1)}
                    onSave={override => {
                        if (enableControlOverrideChanged(override, drill.overrides?.enable_control)) onUpdate(index, { overrides: { ...drill.overrides, enable_control: override } });
                        setRuleRevision(previous => previous + 1);
                    }} /> }]}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, minWidth: 0 }}>
                            <EntityTypeField label="Drill Type" value={drill.type} options={DRILL_TYPES}
                                inputAriaLabel={SELECT_NAMES.drillType} nameOf={value => entityTypeLabel(value, itemLabel)}
                                onChange={type => onUpdate(index, { type: type as DrillFormData['type'] })} sx={{ minWidth: 0, flex: '1 1 200px' }} />
                            <TextField
                                label="Mining speed bonus (%)"
                                type="number"
                                value={speedBonusPercent(drill.speed_bonus)}
                                onChange={(e) =>
                                    onUpdate(index, {
                                        speed_bonus: speedBonusOfPercent(parseFloat(e.target.value) || 0),
                                    })
                                }
                                inputProps={{ step: 10 }}
                                sx={{ minWidth: 0, flex: '1 1 140px' }}
                                size="small"
                            />
                            <TextField
                                label="Productivity (%)"
                                type="number"
                                value={drill.productivity}
                                onChange={(e) =>
                                    onUpdate(index, {
                                        productivity: Math.max(0, parseFloat(e.target.value) || 0),
                                    })
                                }
                                inputProps={{ min: 0, step: 10 }}
                                sx={{ minWidth: 0, flex: '1 1 140px' }}
                                size="small"
                            />
                    </Box>
                </EntitySettings>
            </Box>
        </Box>}
    </SortableItem>;
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
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
    onDuplicate,
}: DrillsFormProps) {

    const build = useMemo(() => ({ machines, belts, chests, inserters, drills }), [machines, belts, chests, inserters, drills]);
    // the row's delete button goes with it: the keyboard moves on to a neighbour's, or to the Add row
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(drills.length, onRemove);
    const announce = useAnnounce();
    const addedLabel = () => entityLabel('drill', Math.max(0, ...drills.map(row => row.id)) + 1);
    const duplicate = (index: number) => {
        afterAdd(() => onDuplicate(index));
        announce(`Added ${addedLabel()}, a copy of ${entityLabel('drill', drills[index].id)}.`);
    };
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

    const add = () => {
        afterAdd(onAdd);
        announce(`Added ${addedLabel()}.`);
    };

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
            actions={listed && (
                <Button startIcon={<Add />} color="inherit" onClick={add} variant="text" size="small" data-row-add="">
                    Add mining drill
                </Button>
            )}
        >
            {!listed ? (
                <AddRow label="Add mining drill" data-row-add="" onClick={add} />
            ) : (
                <>
                    <SortableList itemKeys={drills.map((d) => d._uuid)} onReorder={onReorder}>
                    {drills.map((drill, index) => <DrillRow key={drill._uuid} drill={drill} index={index} resourceNames={resourceNames} build={build} getRecipeInfo={getRecipeInfo}
                        onUpdate={onUpdate} onRemove={remove} onDuplicate={() => duplicate(index)}
                        onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                        onMoveDown={index < drills.length - 1 ? () => onReorder(index, index + 1) : undefined} />)}
                    </SortableList>
                </>
            )}

        </PanelSection>
    );
}

export const DrillsForm = memo(DrillsFormComponent);
