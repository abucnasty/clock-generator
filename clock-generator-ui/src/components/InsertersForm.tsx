import { INSERTER_TIMING_ASSUMPTION, inserterMetadataText, inserterStackSizeHelp } from '../utils/inserterMetadata';
import { Add, Delete } from '@mui/icons-material';
import {
    Autocomplete,
    Box,
    Button,
    IconButton,
    Paper,
    TextField,
    Typography,
} from '@mui/material';
import { TargetType } from 'clock-generator/light';
import { useMemo, useState, memo } from 'react';
import type { BeltFormData, ChestFormData, EnableControlOverride, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { EnableControlModal } from './EnableControlModal';
import { EnableRuleChip } from './EnableRuleChip';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { FactorioIcon } from './FactorioIcon';
import { FilterSlotSelector } from './FilterSlotSelector';
import { useGameNames } from '../hooks/useGameNames';
import { NearLaneSelect } from './NearLaneSelect';
import { NumberField } from './NumberField';
import { SortableItem, SortableList } from './SortableList';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

/** The enable rule's column when the row wraps: "Enable: Clocked" and the like; a longer rule ends in "…" (its full words in the tooltip and name) */
const RULE_COLUMN = '8.5rem';
/** Stack Size's field, and its column when the row wraps */
const STACK_COLUMN = '130px';
/** Where an inserter row fits on one line with its names in full */
const ONE_LINE = '@media (min-width: 1600px)';

/**
 * The inserter rows are one grid, and each row a subgrid of it, so every column starts at the same x on every row,
 * whatever the row holds (a belt source's lane select, set or auto filters, a long rule): the handle and number,
 * Source, Destination, then Stack Size, the filters, the enable rule and delete. Source and Destination take the room
 * the others leave, so their names show in full where they fit. From 1600px a row is one line (narrower, the names
 * would be cut off); from md, two lines, Source and Destination on the first; from sm, Source and Destination each have
 * a line beside the handle; below sm everything has a line of its own.
 */
const LIST_GRID_SX = {
    display: 'grid',
    columnGap: 2,
    rowGap: 2,
    gridTemplateColumns: {
        xs: 'minmax(0, 1fr)',
        sm: 'auto minmax(0, 1fr)',
        md: 'auto minmax(0, 1fr) minmax(0, 1fr)',
    },
    [ONE_LINE]: { gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) auto auto auto auto' },
    // the sortable wrapper of each row passes the columns on
    '& > *': { gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid' },
};
const ROW_GRID_SX = {
    gridColumn: '1 / -1',
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    // room above a wrapped line for the filters' label, which hangs over its slots
    rowGap: 3,
    p: 2,
    // and above a one-line row's
    pt: 2.5,
    bgcolor: 'action.hover',
    borderRadius: 1,
};
/** Under Source, in its column, until md puts the two side by side */
const DESTINATION_CELL_SX = { gridColumn: { sm: 2, md: 'auto' } };
/**
 * Stack Size, the filters, the rule and delete: cells of the rows' grid on one line; below 1600px a line of their own, in
 * columns of a fixed width (the filters take the rest), so they line up from row to row too
 */
const ROW_REST_SX = {
    display: { xs: 'flex', sm: 'grid' },
    gridColumn: '1 / -1',
    gridTemplateColumns: { sm: `${STACK_COLUMN} minmax(0, 1fr) ${RULE_COLUMN} 40px` },
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2,
    [ONE_LINE]: { display: 'contents', gridColumn: 'auto' },
};
/** At the end of its line */
const DELETE_SX = { ml: { xs: 'auto', sm: 0 } };
/** At the top of the line when the row wraps, so Source and Destination stay level when the lane select goes under Source */
const PICKER_GROUP_SX = { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0, alignSelf: 'start', [ONE_LINE]: { alignSelf: 'center' } };
/** The source's lane select goes under it when the cell is narrow */
const SOURCE_GROUP_SX = { ...PICKER_GROUP_SX, flexWrap: 'wrap' };
const PICKER_SX = { flex: '1 1 160px', minWidth: 0 };

interface EntityOption {
    type: SourceSinkType;
    id: number;
    label: string;
    icon: string;
    sublabel?: string;
    ingredientIcons?: string[]; // For belts: ingredient icons to display
}

interface InsertersFormProps {
    inserters: InserterFormData[];
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    itemNames: string[];
    getRecipeInfo: (recipeName: string) => RecipeInfo | null;
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<InserterFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
}

function InsertersFormComponent({
    inserters,
    machines,
    belts,
    chests,
    itemNames,
    getRecipeInfo,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
}: InsertersFormProps) {
    const [enableControlModalInserterIndex, setEnableControlModalInserterIndex] = useState<number | null>(null);

    const { itemLabel, recipeLabel } = useGameNames();

    // Build entity options for the dropdown
    const entityOptions = useMemo<EntityOption[]>(() => {
        const options: EntityOption[] = [];

        // Add machines
        machines.forEach((machine) => {
            options.push({
                type: TargetType.MACHINE,
                id: machine.id,
                label: entityLabel('machine', machine.id),
                icon: machine.recipe || 'assembling-machine-3',
                sublabel: machine.recipe ? recipeLabel(machine.recipe) : 'No recipe',
            });
        });

        // Add belts
        belts.forEach((belt) => {
            const ingredientIcons = belt.lanes.map(lane => lane.ingredient).filter(Boolean);
            options.push({
                type: TargetType.BELT,
                id: belt.id,
                label: entityLabel('belt', belt.id),
                icon: belt.type,
                ingredientIcons: ingredientIcons.length > 0 ? ingredientIcons : undefined,
            });
        });

        // Add chests
        chests.forEach((chest) => {
            let sublabel: string;
            let ingredientIcons: string[] | undefined;
            
            if (isBufferChest(chest)) {
                sublabel = chest.item_filter ? itemLabel(chest.item_filter) : 'No item filter';
                ingredientIcons = chest.item_filter ? [chest.item_filter] : undefined;
            } else {
                // Infinity chest
                const itemNames = chest.item_filter.map(f => f.item_name).filter(Boolean);
                sublabel = itemNames.length > 0 ? itemNames.map(itemLabel).join(', ') : 'No filters';
                ingredientIcons = itemNames.length > 0 ? itemNames : undefined;
            }
            
            options.push({
                type: TargetType.CHEST,
                id: chest.id,
                label: entityLabel('chest', chest.id),
                icon: isInfinityChest(chest) ? 'infinity-chest' : 'iron-chest',
                sublabel,
                ingredientIcons,
            });
        });

        return options;
    }, [machines, belts, chests, itemLabel, recipeLabel]);

    // Find entity option by type and id
    const findEntityOption = (type: SourceSinkType, id: number): EntityOption | undefined => {
        return entityOptions.find(opt => opt.type === type && opt.id === id);
    };

    // Compute inferred filters when explicit filters are not set
    const getInferredFilters = (inserter: InserterFormData): string[] => {
        // Get source items (what the source can provide)
        let sourceItems: string[] = [];
        if (inserter.source.type === TargetType.MACHINE) {
            const machine = machines.find(m => m.id === inserter.source.id);
            if (machine?.recipe) {
                const recipeInfo = getRecipeInfo(machine.recipe);
                if (recipeInfo) {
                    sourceItems = recipeInfo.results; // Machine outputs its recipe results
                }
            }
        } else if (inserter.source.type === TargetType.BELT) {
            // Belt source - get ingredients from lanes
            const belt = belts.find(b => b.id === inserter.source.id);
            if (belt) {
                sourceItems = belt.lanes.map(lane => lane.ingredient).filter(Boolean);
            }
        } else if (inserter.source.type === TargetType.CHEST) {
            // Chest source - get item filter(s)
            const chest = chests.find(c => c.id === inserter.source.id);
            if (chest) {
                if (isBufferChest(chest) && chest.item_filter) {
                    sourceItems = [chest.item_filter];
                } else if (isInfinityChest(chest)) {
                    sourceItems = chest.item_filter.map(f => f.item_name).filter(Boolean);
                }
            }
        }

        // Get sink requirements (what the sink needs)
        let sinkNeeds: string[] = [];
        if (inserter.sink.type === TargetType.MACHINE) {
            const machine = machines.find(m => m.id === inserter.sink.id);
            if (machine?.recipe) {
                const recipeInfo = getRecipeInfo(machine.recipe);
                if (recipeInfo) {
                    sinkNeeds = recipeInfo.ingredients; // Machine needs its recipe ingredients
                }
            }
        } else if (inserter.sink.type === TargetType.BELT) {
            // Belt sink - accept anything from source
            sinkNeeds = sourceItems;
        } else if (inserter.sink.type === TargetType.CHEST) {
            // Chest sink - only accepts its item filter
            const chest = chests.find(c => c.id === inserter.sink.id);
            if (chest) {
                if (isBufferChest(chest) && chest.item_filter) {
                    sinkNeeds = [chest.item_filter];
                } else if (isInfinityChest(chest)) {
                    sinkNeeds = chest.item_filter.map(f => f.item_name).filter(Boolean);
                } else {
                    sinkNeeds = sourceItems;
                }
            } else {
                sinkNeeds = sourceItems;
            }
        }

        // Return intersection of source items and sink needs
        if (sinkNeeds.length === 0) {
            return sourceItems;
        }
        return sourceItems.filter(item => sinkNeeds.includes(item));
    };

    const handleFilterChange = (inserterIndex: number, slotIndex: number, item: string) => {
        const inserter = inserters[inserterIndex];
        const filters = [...(inserter.filters || [])];
        filters[slotIndex] = item;
        // Remove empty trailing slots
        while (filters.length > 0 && !filters[filters.length - 1]) {
            filters.pop();
        }
        onUpdate(inserterIndex, { filters: filters.length > 0 ? filters : undefined });
    };

    const handleRemoveFilter = (inserterIndex: number, slotIndex: number) => {
        const inserter = inserters[inserterIndex];
        let filters = [...(inserter.filters || [])];
        
        // If removing an auto-assigned filter (no explicit filters exist), convert all to explicit first
        if (filters.length === 0) {
            const inferredFilters = getInferredFilters(inserter);
            filters = [...inferredFilters];
        }
        
        // Remove the specified slot
        filters.splice(slotIndex, 1);
        
        // Clean up empty trailing slots
        while (filters.length > 0 && !filters[filters.length - 1]) {
            filters.pop();
        }
        
        onUpdate(inserterIndex, { filters: filters.length > 0 ? filters : undefined });
    };

    // the row's delete button goes with it: the keyboard moves on to a neighbour's
    const { cardRef, remove } = useFocusAfterRemove(inserters.length, onRemove);

    return (
        <Paper ref={cardRef} sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" component="h2">
                    Inserters ({inserters.length})
                </Typography>
                <Button startIcon={<Add />} onClick={onAdd} variant="text" size="small" data-row-add="">
                    Add Inserter
                </Button>
            </Box>

            {inserters.some(inserter => !inserter.prototype || !inserter.quality) && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{INSERTER_TIMING_ASSUMPTION}</Typography>
            )}
            <Box sx={LIST_GRID_SX}>
            <SortableList itemKeys={inserters.map((ins) => ins._uuid)} itemLabels={inserters.map((ins) => entityLabel('inserter', ins.id))} onReorder={onReorder}>
            {inserters.map((inserter, index) => (
                <SortableItem key={inserter._uuid} stableKey={inserter._uuid} label={entityLabel('inserter', inserter.id)}>
                    {(dragHandle) => (
                <Box
                    id={`entity-inserter-${inserter.id}`}
                    role="group"
                    aria-label={entityLabel('inserter', inserter.id)}
                    sx={ROW_GRID_SX}
                >
                    <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
                        {inserterMetadataText(inserter)}
                    </Typography>
                    {dragHandle}
                    {/* Source */}
                    <Box sx={SOURCE_GROUP_SX}>
                        <Autocomplete
                            size="small"
                            sx={PICKER_SX}
                            options={entityOptions}
                            value={findEntityOption(inserter.source.type, inserter.source.id)}
                            onChange={(_, newValue) => {
                                if (newValue) {
                                    onUpdate(index, {
                                        source: { type: newValue.type, id: newValue.id },
                                    });
                                }
                            }}
                            getOptionLabel={(option) => {
                                if (option.sublabel) return `${option.label} - ${option.sublabel}`;
                                if (option.ingredientIcons) return option.label;
                                return option.label;
                            }}
                            isOptionEqualToValue={(option, value) =>
                                option.type === value.type && option.id === value.id
                            }
                            renderInput={(params) => {
                                const selectedOption = findEntityOption(inserter.source.type, inserter.source.id);
                                return (
                                    <TextField
                                        {...params}
                                        label="Source"
                                        error={!selectedOption}
                                        slotProps={{
                                            input: {
                                                ...params.InputProps,
                                                startAdornment: selectedOption ? (
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                                                        <FactorioIcon name={selectedOption.icon} size={20} />
                                                        {selectedOption.ingredientIcons && (
                                                            <>
                                                                <Typography variant="body2" sx={{ mx: 0.5 }}>:</Typography>
                                                                {selectedOption.ingredientIcons.map((ing, i) => (
                                                                    <FactorioIcon key={i} name={ing} size={18} />
                                                                ))}
                                                            </>
                                                        )}
                                                    </Box>
                                                ) : null,
                                            },
                                        }}
                                    />
                                );
                            }}
                            renderOption={(props, option) => {
                                const { key, ...rest } = props;
                                return (
                                    <Box
                                        component="li"
                                        key={key}
                                        {...rest}
                                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                                    >
                                        <FactorioIcon name={option.icon} size={24} alt="" />
                                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                            <Typography variant="body2">{option.label}</Typography>
                                            {option.sublabel ? (
                                                <Typography variant="caption" color="text.secondary">
                                                    {option.sublabel}
                                                </Typography>
                                            ) : option.ingredientIcons ? (
                                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                                    {option.ingredientIcons.map((ing, i) => (
                                                        <FactorioIcon key={i} name={ing} size={16} />
                                                    ))}
                                                </Box>
                                            ) : (
                                                <Typography variant="caption" color="text.secondary">
                                                    No items
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                );
                            }}
                            autoHighlight
                            disableClearable
                        />

                    {/* the same select as the diagram's inserter dialog; a new source drops the lane, as there */}
                    <NearLaneSelect
                        compact
                        source={inserter.source}
                        belts={belts}
                        entityLabel={entityLabel('inserter', inserter.id)}
                        onChange={(source) => onUpdate(index, { source })}
                    />

                    </Box>

                    {/* Sink, with the arrow before it so that a wrap never leaves the arrow at the end of a line */}
                    <Box sx={{ ...PICKER_GROUP_SX, ...DESTINATION_CELL_SX }}>
                        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
                            →
                        </Typography>
                        <Autocomplete
                            size="small"
                            sx={PICKER_SX}
                            options={entityOptions}
                            value={findEntityOption(inserter.sink.type, inserter.sink.id)}
                            onChange={(_, newValue) => {
                                if (newValue) {
                                    onUpdate(index, {
                                        sink: { type: newValue.type, id: newValue.id },
                                    });
                                }
                            }}
                            getOptionLabel={(option) => {
                                if (option.sublabel) return `${option.label} - ${option.sublabel}`;
                                if (option.ingredientIcons) return option.label;
                                return option.label;
                            }}
                            isOptionEqualToValue={(option, value) =>
                                option.type === value.type && option.id === value.id
                            }
                            renderInput={(params) => {
                                const selectedOption = findEntityOption(inserter.sink.type, inserter.sink.id);
                                return (
                                    <TextField
                                        {...params}
                                        label="Destination"
                                        error={!selectedOption}
                                        slotProps={{
                                            input: {
                                                ...params.InputProps,
                                                startAdornment: selectedOption ? (
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                                                        <FactorioIcon name={selectedOption.icon} size={20} />
                                                        {selectedOption.ingredientIcons && (
                                                            <>
                                                                <Typography variant="body2" sx={{ mx: 0.5 }}>:</Typography>
                                                                {selectedOption.ingredientIcons.map((ing, i) => (
                                                                    <FactorioIcon key={i} name={ing} size={18} />
                                                                ))}
                                                            </>
                                                        )}
                                                    </Box>
                                                ) : null,
                                            },
                                        }}
                                    />
                                );
                            }}
                            renderOption={(props, option) => {
                                const { key, ...rest } = props;
                                return (
                                    <Box
                                        component="li"
                                        key={key}
                                        {...rest}
                                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                                    >
                                        <FactorioIcon name={option.icon} size={24} alt="" />
                                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                            <Typography variant="body2">{option.label}</Typography>
                                            {option.sublabel ? (
                                                <Typography variant="caption" color="text.secondary">
                                                    {option.sublabel}
                                                </Typography>
                                            ) : option.ingredientIcons ? (
                                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                                    {option.ingredientIcons.map((ing, i) => (
                                                        <FactorioIcon key={i} name={ing} size={16} />
                                                    ))}
                                                </Box>
                                            ) : (
                                                <Typography variant="caption" color="text.secondary">
                                                    No items
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                );
                            }}
                            autoHighlight
                            disableClearable
                        />
                    </Box>

                    <Box sx={ROW_REST_SX}>
                    <NumberField
                        id={`inserter-stack-size-${inserter.id}`}
                        label="Stack size"
                        value={inserter.stack_size ?? null}
                        placeholder="Automatic"
                        helperText={inserterStackSizeHelp(inserter)}
                        onValueChange={(val) =>
                            onUpdate(index, { stack_size: val === null ? undefined : Math.trunc(val) })
                        }
                        min={1}
                        sx={{ width: STACK_COLUMN, maxWidth: '100%' }}
                        size="small"
                    />

                    {/* Item Filter Slots */}
                    <FilterSlotSelector
                        filters={inserter.filters}
                        inferredFilters={getInferredFilters(inserter)}
                        itemNames={itemNames}
                        onFilterChange={(slotIndex, item) => handleFilterChange(index, slotIndex, item)}
                        onRemoveFilter={(slotIndex) => handleRemoveFilter(index, slotIndex)}
                        maxSlots={5}
                    />

                    <Box sx={{ display: 'flex', minWidth: 0 }}>
                    <EnableRuleChip
                        override={inserter.overrides?.enable_control}
                        entityLabel={entityLabel('inserter', inserter.id)}
                        entityType="inserter"
                        forcedAlways={inserter._forced_always}
                        onClick={() => setEnableControlModalInserterIndex(index)}
                    />

                    </Box>

                    <IconButton onClick={() => remove(index)} color="error" sx={DELETE_SX} aria-label={deleteButtonLabel('inserter', inserter.id)} data-row-delete="">
                        <Delete />
                    </IconButton>
                    </Box>
                </Box>
                    )}
                </SortableItem>
            ))}
            </SortableList>
            </Box>

            {inserters.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    No inserters configured. Add at least one inserter to move items.
                </Typography>
            )}

            {/* the enable rule modal */}
            <EnableControlModal
                open={enableControlModalInserterIndex !== null}
                onClose={() => setEnableControlModalInserterIndex(null)}
                entityType="inserter"
                entityLabel={enableControlModalInserterIndex !== null && inserters[enableControlModalInserterIndex] ? entityLabel('inserter', inserters[enableControlModalInserterIndex].id) : ''}
                currentOverride={enableControlModalInserterIndex !== null ? inserters[enableControlModalInserterIndex]?.overrides?.enable_control : undefined}
                sourceType={enableControlModalInserterIndex !== null ? inserters[enableControlModalInserterIndex]?.source?.type : undefined}
                sinkType={enableControlModalInserterIndex !== null ? inserters[enableControlModalInserterIndex]?.sink?.type : undefined}
                copyFromOptions={inserters
                    .map((ins, idx) => ({ inserter: ins, index: idx }))
                    .filter(({ inserter, index }) => 
                        index !== enableControlModalInserterIndex && 
                        inserter.overrides?.enable_control && 
                        inserter.overrides.enable_control.mode !== 'AUTO'
                    )
                    .map(({ inserter }) => ({
                        label: entityLabel('inserter', inserter.id),
                        override: inserter.overrides!.enable_control!,
                    }))
                }
                availableItems={(() => {
                    if (enableControlModalInserterIndex === null) return [];
                    const inserter = inserters[enableControlModalInserterIndex];
                    const items = new Set<string>();
                    
                    // Get items from source
                    if (inserter?.source?.type === TargetType.MACHINE) {
                        const machine = machines.find(m => m.id === inserter.source.id);
                        if (machine?.recipe) {
                            const recipeInfo = getRecipeInfo(machine.recipe);
                            if (recipeInfo) {
                                recipeInfo.results.forEach(r => items.add(r));
                                recipeInfo.ingredients.forEach(i => items.add(i));
                            }
                        }
                    } else if (inserter?.source?.type === TargetType.BELT) {
                        const belt = belts.find(b => b.id === inserter.source.id);
                        if (belt) {
                            belt.lanes.forEach(lane => {
                                if (lane.ingredient) items.add(lane.ingredient);
                            });
                        }
                    } else if (inserter?.source?.type === TargetType.CHEST) {
                        const chest = chests.find(c => c.id === inserter.source.id);
                        if (chest) {
                            if (isBufferChest(chest) && chest.item_filter) {
                                items.add(chest.item_filter);
                            } else if (isInfinityChest(chest)) {
                                chest.item_filter.forEach(f => {
                                    if (f.item_name) items.add(f.item_name);
                                });
                            }
                        }
                    }

                    // Get items from sink
                    if (inserter?.sink?.type === TargetType.MACHINE) {
                        const machine = machines.find(m => m.id === inserter.sink.id);
                        if (machine?.recipe) {
                            const recipeInfo = getRecipeInfo(machine.recipe);
                            if (recipeInfo) {
                                recipeInfo.results.forEach(r => items.add(r));
                                recipeInfo.ingredients.forEach(i => items.add(i));
                            }
                        }
                    } else if (inserter?.sink?.type === TargetType.BELT) {
                        const belt = belts.find(b => b.id === inserter.sink.id);
                        if (belt) {
                            belt.lanes.forEach(lane => {
                                if (lane.ingredient) items.add(lane.ingredient);
                            });
                        }
                    } else if (inserter?.sink?.type === TargetType.CHEST) {
                        const chest = chests.find(c => c.id === inserter.sink.id);
                        if (chest) {
                            if (isBufferChest(chest) && chest.item_filter) {
                                items.add(chest.item_filter);
                            } else if (isInfinityChest(chest)) {
                                chest.item_filter.forEach(f => {
                                    if (f.item_name) items.add(f.item_name);
                                });
                            }
                        }
                    }

                    return Array.from(items);
                })()}
                onSave={(override: EnableControlOverride | undefined) => {
                    if (enableControlModalInserterIndex !== null) {
                        const inserter = inserters[enableControlModalInserterIndex];
                        onUpdate(enableControlModalInserterIndex, {
                            overrides: {
                                ...inserter.overrides,
                                enable_control: override,
                            },
                        });
                    }
                    setEnableControlModalInserterIndex(null);
                }}
            />
        </Paper>
    );
}

export const InsertersForm = memo(InsertersFormComponent);
