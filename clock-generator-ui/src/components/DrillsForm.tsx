import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { useState, memo } from 'react';
import type { DrillFormData, EnableControlOverride } from '../hooks/useConfigForm';
import { useFocusAfterAdd, useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { SURFACE } from '../theme/tokens';
import { AddRow } from './AddRow';
import { EnableControlModal } from './EnableControlModal';
import { EnableRuleChip } from './EnableRuleChip';
import { FactorioIcon } from './FactorioIcon';
import { HelpCommand } from './HelpButton';
import { PanelSection } from './Panel';
import { ItemSelector } from './ItemSelector';
import { SortableItem, SortableList } from './SortableList';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
import { BUTTON_NAMES, SELECT_NAMES } from '../utils/a11yLabels';
import { useGameNames } from '../hooks/useGameNames';
import { DRILL_TYPES, entityTypeLabel } from './entityTypes';

const SPEED_BONUS_COMMAND = '/c game.print(game.player.selected.speed_bonus)';

interface DrillsFormProps {
    miningProductivityLevel: number;
    drills: DrillFormData[];
    resourceNames: string[];
    machineIds: number[];
    onUpdateProductivityLevel: (value: number) => void;
    /** Adds a drill, and turns drills on in the build if they were not */
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<DrillFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * The build's mining drills. With none (and no productivity level to keep), the section is one "Add mining drill" row:
 * a build without drills and one with drills turned off are the same to the generator.
 */
function DrillsFormComponent({
    miningProductivityLevel,
    drills,
    resourceNames,
    machineIds,
    onUpdateProductivityLevel,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
}: DrillsFormProps) {
    const { itemLabel } = useGameNames();
    const [enableControlModalDrillIndex, setEnableControlModalDrillIndex] = useState<number | null>(null);

    // the row's delete button goes with it: the keyboard moves on to a neighbour's, or to the Add row
    const { cardRef, remove } = useFocusAfterRemove(drills.length, onRemove);
    // the Add row goes with the first drill: the keyboard moves on to that drill's type
    const focusAdded = useFocusAfterAdd(drills.length, cardRef);
    const listed = drills.length > 0 || miningProductivityLevel > 0;

    return (
        // the same section in both shapes, so that the focus finds the Add row in it once the last drill goes
        <PanelSection
            ref={cardRef}
            level={3}
            title={listed ? `Mining drills (${drills.length})` : 'Mining drills'}
            help={{
                label: BUTTON_NAMES.aboutDrills,
                content: (
                    <>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            To get the speed bonus of a mining drill in Factorio, hover over the drill and run this command:
                        </Typography>
                        <HelpCommand command={SPEED_BONUS_COMMAND} />
                    </>
                ),
            }}
            // with none, the Add row below is the one add
            actions={listed && (
                <Button startIcon={<Add />} onClick={onAdd} variant="text" size="small" data-row-add="">
                    Add Drill
                </Button>
            )}
        >
            {!listed ? (
                <AddRow label="Add mining drill" data-row-add="" onClick={() => { focusAdded(); onAdd(); }} />
            ) : (
                <>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                        <TextField
                            label="Mining Productivity Level"
                            type="number"
                            value={miningProductivityLevel}
                            onChange={(e) =>
                                onUpdateProductivityLevel(parseInt(e.target.value) || 0)
                            }
                            inputProps={{ min: 0 }}
                            sx={{ width: 200 }}
                            size="small"
                        />
                    </Box>

                    <SortableList itemKeys={drills.map((d) => d._uuid)} itemLabels={drills.map((d) => entityLabel('drill', d.id))} onReorder={onReorder}>
                    {drills.map((drill, index) => (
                        <SortableItem key={drill._uuid} stableKey={drill._uuid} label={entityLabel('drill', drill.id)}>
                            {(dragHandle) => (
                        <Box
                            role="group"
                            aria-label={entityLabel('drill', drill.id)}
                            sx={{
                                display: 'flex',
                                gap: 2,
                                alignItems: 'center',
                                mb: 2,
                                p: 2,
                                bgcolor: SURFACE.row,
                                flexWrap: 'wrap',
                            }}
                        >
                            {dragHandle}
                            <FormControl size="small" sx={{ minWidth: 180 }}>
                                <InputLabel>Drill Type</InputLabel>
                                <Select
                                    inputProps={{ 'aria-label': SELECT_NAMES.drillType }}
                                    value={drill.type}
                                    label="Drill Type"
                                    onChange={(e) =>
                                        onUpdate(index, {
                                            type: e.target.value as DrillFormData['type'],
                                        })
                                    }
                                    renderValue={(selected) => (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <FactorioIcon name={selected} size={20} alt="" />
                                            {entityTypeLabel(selected, itemLabel)}
                                        </Box>
                                    )}
                                >
                                    {DRILL_TYPES.map((dt) => (
                                        <MenuItem key={dt.value} value={dt.value}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <FactorioIcon name={dt.value} size={20} alt="" />
                                                {entityTypeLabel(dt.value, itemLabel)}
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <ItemSelector
                                value={drill.mined_item_name || ''}
                                onChange={(newValue) => {
                                    if (newValue) {
                                        onUpdate(index, { mined_item_name: newValue });
                                    }
                                }}
                                options={resourceNames}
                                label="Mined Resource"
                            />
                            <TextField
                                label="Speed Bonus"
                                type="number"
                                value={drill.speed_bonus}
                                onChange={(e) =>
                                    onUpdate(index, {
                                        speed_bonus: parseFloat(e.target.value) || 0,
                                    })
                                }
                                inputProps={{ step: 0.1 }}
                                sx={{ width: 120 }}
                                size="small"
                            />
                            <FormControl size="small" sx={{ minWidth: 120 }} error={!machineIds.includes(drill.target.id)}>
                                <InputLabel>Target Machine</InputLabel>
                                <Select
                                    inputProps={{ 'aria-label': SELECT_NAMES.targetMachine }}
                                    value={drill.target.id}
                                    label="Target Machine"
                                    onChange={(e) =>
                                        onUpdate(index, {
                                            target: { type: 'machine', id: e.target.value as number },
                                        })
                                    }
                                >
                                    {machineIds.map((id) => (
                                        <MenuItem key={id} value={id}>
                                            {entityLabel('machine', id)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <EnableRuleChip
                                override={drill.overrides?.enable_control}
                                entityLabel={entityLabel('drill', drill.id)}
                                entityType="drill"
                                onClick={() => setEnableControlModalDrillIndex(index)}
                            />
                            <IconButton onClick={() => remove(index)} color="error" sx={{ ml: 'auto' }} aria-label={deleteButtonLabel('drill', drill.id)} data-row-delete="">
                                <Delete />
                            </IconButton>
                        </Box>
                            )}
                        </SortableItem>
                    ))}
                    </SortableList>
                </>
            )}

            {/* the enable rule modal */}
            <EnableControlModal
                open={enableControlModalDrillIndex !== null}
                onClose={() => setEnableControlModalDrillIndex(null)}
                entityType="drill"
                entityLabel={enableControlModalDrillIndex !== null && drills[enableControlModalDrillIndex] ? entityLabel('drill', drills[enableControlModalDrillIndex].id) : ''}
                currentOverride={enableControlModalDrillIndex !== null ? drills[enableControlModalDrillIndex]?.overrides?.enable_control : undefined}
                sinkType="machine"
                availableItems={(() => {
                    if (enableControlModalDrillIndex === null) return [];
                    const drill = drills[enableControlModalDrillIndex];
                    if (drill?.mined_item_name) {
                        return [drill.mined_item_name];
                    }
                    return [];
                })()}
                onSave={(override: EnableControlOverride | undefined) => {
                    if (enableControlModalDrillIndex !== null) {
                        const drill = drills[enableControlModalDrillIndex];
                        onUpdate(enableControlModalDrillIndex, {
                            overrides: {
                                ...drill.overrides,
                                enable_control: override,
                            },
                        });
                    }
                    setEnableControlModalDrillIndex(null);
                }}
            />
        </PanelSection>
    );
}

export const DrillsForm = memo(DrillsFormComponent);
