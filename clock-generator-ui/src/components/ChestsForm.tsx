import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    IconButton,
    Menu,
    MenuItem,
    Typography,
} from '@mui/material';
import { memo, useId, useState } from 'react';
import { ChestType } from 'clock-generator/light';
import type { ChestFormData } from '../hooks/useConfigForm';
import { CHEST_TYPE_LABELS, CONTAINER_CHEST_TYPES, chestTypeIcon, isContainerChest } from '../utils/configForm/formData';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { AddRow } from './AddRow';
import { ChestFields } from './EntityFields';
import { ContainerChestFields, ContainerChestSummary } from './ContainerChestFields';
import { EntitySettings } from './EntitySettings';
import { PanelSection } from './Panel';
import { SortableItem, SortableList } from './SortableList';
import { RowActionsMenu } from './RowActionsMenu';
import { useAnnounce } from '../hooks/useMessages';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';

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
                    menu={[ChestType.BUFFER_CHEST, ChestType.INFINITY_CHEST, ...CONTAINER_CHEST_TYPES].map(type =>
                        ({ label: CHEST_TYPE_LABELS[type], onSelect: () => { add(type); } }))}
                />
            ) : (
                <PanelSection
                    level={4}
                    title={`Chests (${chests.length})`}
                    help={{
                        label: 'About chests',
                        content: <>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                <strong>Buffer chests</strong> store items in a finite inventory and can fill up.
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                <strong>Infinity chest filters</strong> set the stock to maintain. Pickups are replenished,
                                and deliveries above that stock are removed, even with unfiltered removal off.
                                A stock of 0 removes that item and supplies none.
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                <strong>Also remove unfiltered items</strong> removes incoming items without a filter.
                                With no filters, it removes all incoming items and supplies none. This matches the
                                “Remove unfiltered items” checkbox in Factorio. With this setting off, the simulator
                                only accepts filtered items.
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                <strong>Cars, tanks and cargo wagons</strong> hold mixed items, a stack a slot, and can fill
                                up or run dry. A filtered slot takes only its item. A wagon's slots depend on its quality.
                                No item and Deconstruction planner block slots so inserters cannot fill them.
                                A wagon is taken as standing still: moving trains are not simulated.
                            </Typography>
                            <Typography variant="body2">
                                <strong>A rocket silo</strong> takes the rocket part's ingredients into its input slots and
                                any other item into its rocket, up to the weight the rocket lifts. No rocket is built or
                                launched.
                            </Typography>
                        </>,
                    }}
                    actions={(
                        <>
                            <Button startIcon={<Add />} color="inherit" onClick={() => add(ChestType.BUFFER_CHEST)} variant="text" size="small" data-row-add="">
                                Buffer chest
                            </Button>
                            <Button startIcon={<Add />} color="inherit" onClick={() => add(ChestType.INFINITY_CHEST)} variant="text" size="small">
                                Infinity chest
                            </Button>
                            <AddContainerMenu onAdd={add} />
                        </>
                    )}
                >
                    <SortableList itemKeys={chests.map((c) => c._uuid)} onReorder={onReorder}>
                    {chests.map((chest, index) => (
                        <SortableItem key={chest._uuid} stableKey={chest._uuid} label={entityLabel('chest', chest.id)} displayLabel={<EntityBadge id={chest.id}><FactorioIcon name={chestTypeIcon(chest.type)} size={28} alt="" /></EntityBadge>}>
                            {(dragHandle) => (
                        <Box
                            id={`entity-chest-${chest.id}`}
                            role="group"
                            aria-label={entityLabel('chest', chest.id)}
                            sx={{
                                mb: 2,
                                p: 2,
                                minWidth: 0,
                                containerType: 'inline-size',
                                containerName: 'chest-row',
                                bgcolor: (theme: Theme) => themeTokens(theme).surface.row,
                            }}
                        >
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 1.5, alignItems: 'center', '@container chest-row (max-width: 600px)': { gridTemplateColumns: 'minmax(0, 1fr) auto' } }}>
                                <Box sx={{ gridColumn: 1, gridRow: 1 }}>{dragHandle}</Box>
                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', minWidth: 0, gridColumn: 2, gridRow: 1, '@container chest-row (max-width: 600px)': { gridColumn: '1 / -1', gridRow: 2 } }}>
                                <ChestFields chest={chest} itemNames={itemNames} storageHelp={STORAGE_SIZE_HELP} containerDetails={false}
                                    onChange={updates => onUpdate(index, updates)} onSwitchType={type => onSwitchType(index, type)} />
                            </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gridColumn: 3, gridRow: 1, '@container chest-row (max-width: 600px)': { gridColumn: 2 } }}>
                                    {isContainerChest(chest) && <Box id={`settings-actions-chest-${chest.id}`} sx={{ display: 'flex' }} />}
                                    <RowActionsMenu label={entityLabel('chest', chest.id)} onDuplicate={() => duplicate(index)}
                                        onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                                        onMoveDown={index < chests.length - 1 ? () => onReorder(index, index + 1) : undefined} />
                                    <IconButton onClick={() => remove(index)} color="error" aria-label={deleteButtonLabel('chest', chest.id)} data-row-delete="">
                                        <Delete />
                                    </IconButton>
                                </Box>
                            </Box>
                            {isContainerChest(chest) && <Box sx={{ mt: 1 }}>
                                <EntitySettings actionContainerId={`settings-actions-chest-${chest.id}`} label={entityLabel('chest', chest.id)}
                                    summary={<ContainerChestSummary chest={chest} />}>
                                    <ContainerChestFields chest={chest} itemNames={itemNames} dialog onChange={updates => onUpdate(index, updates)} />
                                </EntitySettings>
                            </Box>}
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

/** The button that adds a car, a tank, a cargo wagon or a rocket silo, from a menu */
function AddContainerMenu({ onAdd }: { onAdd: (type: ChestType) => void }) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const menuId = useId();
    const label = 'Vehicle or silo';
    return <>
        <Button startIcon={<Add />} color="inherit" variant="text" size="small" aria-haspopup="menu" aria-expanded={anchor !== null}
            aria-controls={anchor ? menuId : undefined} onClick={event => setAnchor(event.currentTarget)}>
            {label}
        </Button>
        <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)} slotProps={{ list: { 'aria-label': label } }}>
            {CONTAINER_CHEST_TYPES.map(type => <MenuItem key={type} onClick={() => { setAnchor(null); onAdd(type); }}>
                <FactorioIcon name={chestTypeIcon(type)} size={20} alt="" /><Box component="span" sx={{ ml: 1 }}>{CHEST_TYPE_LABELS[type]}</Box>
            </MenuItem>)}
        </Menu>
    </>;
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
