import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { memo } from 'react';
import { ChestType } from 'clock-generator/light';
import type { ChestFormData } from '../hooks/useConfigForm';
import { isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { AddRow } from './AddRow';
import { ChestFilterSlotSelector, type ChestFilterSlot } from './ChestFilterSlotSelector';
import { HelpButton } from './HelpButton';
import { PanelSection } from './Panel';
import { ItemSelector } from './ItemSelector';
import { SortableItem, SortableList } from './SortableList';
import { RowActionsMenu } from './RowActionsMenu';
import { useAnnounce } from '../hooks/useMessages';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
import { SELECT_NAMES } from '../utils/a11yLabels';

interface ChestsFormProps {
    chests: ChestFormData[];
    itemNames: string[];
    onAdd: (chestType?: ChestType) => void;
    onUpdate: (index: number, updates: Partial<ChestFormData>) => void;
    onSwitchType: (index: number, newType: ChestType) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onDuplicate: (index: number) => void;
}

function ChestsFormComponent({
    chests,
    itemNames,
    onAdd,
    onUpdate,
    onSwitchType,
    onRemove,
    onReorder,
    onDuplicate,
}: ChestsFormProps) {
    // Convert infinity chest to filter slot format
    const getInfinityChestFilters = (chest: ChestFormData): ChestFilterSlot[] => {
        if (!isInfinityChest(chest)) return [];
        return chest.item_filter.map(f => ({
            item_name: f.item_name,
            quantity: f.request_count,
        }));
    };

    // Handle infinity chest filter change
    const handleInfinityChestFilterChange = (chestIndex: number, slotIndex: number, filter: ChestFilterSlot) => {
        const chest = chests[chestIndex];
        if (!isInfinityChest(chest)) return;

        const newFilters = [...chest.item_filter];
        newFilters[slotIndex] = {
            item_name: filter.item_name,
            request_count: filter.quantity,
        };
        onUpdate(chestIndex, { item_filter: newFilters });
    };

    // Handle infinity chest filter remove
    const handleInfinityChestRemoveFilter = (chestIndex: number, slotIndex: number) => {
        const chest = chests[chestIndex];
        if (!isInfinityChest(chest)) return;

        // Don't allow removing the last filter
        if (chest.item_filter.length <= 1) {
            // Clear the filter instead
            onUpdate(chestIndex, {
                item_filter: [{ item_name: '', request_count: 1 }],
            });
            return;
        }

        onUpdate(chestIndex, {
            item_filter: chest.item_filter.filter((_, i) => i !== slotIndex),
        });
    };

    // Handle adding a new filter to infinity chest
    const handleInfinityChestAddFilter = (chestIndex: number) => {
        const chest = chests[chestIndex];
        if (!isInfinityChest(chest)) return;

        onUpdate(chestIndex, {
            item_filter: [...chest.item_filter, { item_name: '', request_count: 1 }],
        });
    };

    // the row's delete button goes with it: the keyboard moves on to a neighbour's
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(chests.length, onRemove);
    const announce = useAnnounce();
    const addedLabel = () => entityLabel('chest', Math.max(0, ...chests.map(row => row.id)) + 1);
    const duplicate = (index: number) => {
        afterAdd(() => onDuplicate(index));
        announce(`Added ${addedLabel()}, a copy of ${entityLabel('chest', chests[index].id)}.`);
    };

    const add = (type: ChestType) => {
        afterAdd(() => onAdd(type));
        announce(`Added ${addedLabel()}.`);
    };

    return (
        // the same element in both shapes, so that the focus finds the Add row in it once the last chest goes
        <Box ref={cardRef}>
            {chests.length === 0 ? (
                <AddRow
                    label="Add chest"
                    data-row-add=""
                    menu={[
                        { label: 'Buffer chest', onSelect: () => { add(ChestType.BUFFER_CHEST); } },
                        { label: 'Infinity chest', onSelect: () => { add(ChestType.INFINITY_CHEST); } },
                    ]}
                />
            ) : (
                <PanelSection
                    level={4}
                    title={`Chests (${chests.length})`}
                    actions={(
                        <>
                            <Button startIcon={<Add />} onClick={() => add(ChestType.BUFFER_CHEST)} variant="text" size="small" data-row-add="">
                                Buffer chest
                            </Button>
                            <Button startIcon={<Add />} onClick={() => add(ChestType.INFINITY_CHEST)} variant="text" size="small">
                                Infinity chest
                            </Button>
                        </>
                    )}
                >
                    <SortableList itemKeys={chests.map((c) => c._uuid)} onReorder={onReorder}>
                    {chests.map((chest, index) => (
                        <SortableItem key={chest._uuid} stableKey={chest._uuid} label={entityLabel('chest', chest.id)}>
                            {(dragHandle) => (
                        <Box
                            id={`entity-chest-${chest.id}`}
                            role="group"
                            aria-label={entityLabel('chest', chest.id)}
                            sx={{
                                mb: 2,
                                p: 2,
                                bgcolor: (theme: Theme) => themeTokens(theme).surface.row,
                            }}
                        >
                            {/* Header row with ID, Type, Filters, and Delete */}
                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                                {dragHandle}

                                <FormControl data-row-first="" size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>Type</InputLabel>
                                    <Select
                                        inputProps={{ 'aria-label': SELECT_NAMES.chestType }}
                                        value={chest.type}
                                        label="Type"
                                        onChange={(e) => onSwitchType(index, e.target.value)}
                                    >
                                        <MenuItem value={ChestType.BUFFER_CHEST}>Buffer chest</MenuItem>
                                        <MenuItem value={ChestType.INFINITY_CHEST}>Infinity chest</MenuItem>
                                    </Select>
                                </FormControl>

                                {/* Buffer Chest fields - item filter and storage size */}
                                {isBufferChest(chest) && (
                                    <>
                                        <ItemSelector
                                            value={chest.item_filter || null}
                                            options={itemNames}
                                            onChange={(newValue) => onUpdate(index, { item_filter: newValue || '' })}
                                            label="Item Filter"
                                            size="small"
                                            minWidth={200}
                                        />
                                        <TextField
                                            label="Storage Size"
                                            type="number"
                                            value={chest.storage_size}
                                            onChange={(e) => onUpdate(index, { storage_size: parseInt(e.target.value) || 1 })}
                                            inputProps={{ min: 1 }}
                                            sx={{ width: 140 }}
                                            size="small"
                                            slotProps={{
                                                input: {
                                                    endAdornment: (
                                                        <InputAdornment position="end" sx={{ mr: -1 }}>
                                                            <HelpButton label="About storage size">{STORAGE_SIZE_HELP}</HelpButton>
                                                        </InputAdornment>
                                                    ),
                                                },
                                            }}
                                        />
                                    </>
                                )}

                                {/* Infinity Chest filter slots - multiple slots */}
                                {isInfinityChest(chest) && (
                                    <ChestFilterSlotSelector
                                        filters={getInfinityChestFilters(chest)}
                                        itemNames={itemNames}
                                        onFilterChange={(slotIndex, filter) =>
                                            handleInfinityChestFilterChange(index, slotIndex, filter)
                                        }
                                        onRemoveFilter={(slotIndex) =>
                                            handleInfinityChestRemoveFilter(index, slotIndex)
                                        }
                                        onAddFilter={() => handleInfinityChestAddFilter(index)}
                                        maxSlots={10}
                                        quantityLabel="Request Count"
                                        canAddMore={true}
                                    />
                                )}

                                <Box sx={{ flex: 1 }} />

                                <RowActionsMenu label={entityLabel('chest', chest.id)} onDuplicate={() => duplicate(index)}
                                    onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                                    onMoveDown={index < chests.length - 1 ? () => onReorder(index, index + 1) : undefined} />
                                <IconButton onClick={() => remove(index)} color="error" aria-label={deleteButtonLabel('chest', chest.id)} data-row-delete="">
                                    <Delete />
                                </IconButton>
                            </Box>
                        </Box>
                            )}
                        </SortableItem>
                    ))}
                    </SortableList>
                </PanelSection>
            )}
        </Box>
    );
}

/** What Storage Size is, and where to find it in the game */
const STORAGE_SIZE_HELP = (
    <>
        <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>Storage Size</strong> is the number of slots of the chest that the simulator uses to buffer items.
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
            In Factorio, you can limit a chest's storage by clicking on the red X in the chest's inventory. This limits
            how many slots are available for items.
        </Typography>
        <Box
            component="img"
            src="/images/chest_slot_count_example.png"
            alt="Example of chest slot limit in Factorio showing 8 slots available out of 48"
            sx={{ width: '100%', display: 'block', my: 1, border: (theme: Theme) => `1px solid ${themeTokens(theme).control.edge}` }}
        />
        <Typography variant="body2" color="text.secondary">
            <strong>Example:</strong> if your chest has 8 slots available (as shown above), enter "8" as the storage
            size. This tells the simulator how much buffer the inserters have to work with.
        </Typography>
    </>
);

export const ChestsForm = memo(ChestsFormComponent);
