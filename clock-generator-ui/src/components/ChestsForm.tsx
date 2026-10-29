import { FactorioIcon } from './FactorioIcon';
import { Box, Typography } from '@mui/material';
import { memo } from 'react';
import { ChestType } from 'clock-generator/light';
import type { ChestFormData } from '../hooks/useConfigForm';
import { CHEST_TYPE_LABELS, CONTAINER_CHEST_TYPES, chestTypeIcon, isContainerChest } from '../utils/configForm/formData';
import { useEntityRows } from '../hooks/useEntityRows';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { AddButton, AddMenuButton, AddRow } from './AddRow';
import { EntityRow, EntityRowActions, EntityRowTop } from './EntityRow';
import { ChestFields } from './EntityFields';
import { ContainerChestFields, ContainerChestSummary } from './ContainerChestFields';
import { EntitySettings } from './EntitySettings';
import { PanelSection } from './Panel';
import { SortableList } from './SortableList';
import { chestLabel, settingsSlotId } from '../utils/entityLabel';

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
    const { cardRef, add: addRow, duplicate, remove } = useEntityRows(chests, { labelOf: chestLabel, onRemove, onDuplicate });
    const add = (type: ChestType) => addRow(() => onAdd(type), { type } as ChestFormData);

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
                            <AddButton label="Buffer chest" onClick={() => add(ChestType.BUFFER_CHEST)} />
                            <AddButton label="Infinity chest" focusTarget={false} onClick={() => add(ChestType.INFINITY_CHEST)} />
                            <AddMenuButton label="Vehicle or silo" focusTarget={false} items={CONTAINER_CHEST_TYPES.map(type => ({
                                label: CHEST_TYPE_LABELS[type], icon: <FactorioIcon name={chestTypeIcon(type)} size={20} alt="" />, onSelect: () => add(type),
                            }))} />
                        </>
                    )}
                >
                    <SortableList itemKeys={chests.map((c) => c._uuid)} onReorder={onReorder}>
                    {chests.map((chest, index) => {
                        const label = chestLabel(chest);
                        return <EntityRow key={chest._uuid} kind="chest" row={chest} label={label} icon={<FactorioIcon name={chestTypeIcon(chest.type)} size={28} alt="" />}>
                            {dragHandle => <>
                                <EntityRowTop dragHandle={dragHandle} stackBelow={600} actions={<EntityRowActions kind="chest" id={chest.id} label={label}
                                    details={isContainerChest(chest)} index={index} count={chests.length} onReorder={onReorder} onDuplicate={duplicate} onDelete={remove} />}>
                                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <ChestFields chest={chest} itemNames={itemNames} storageHelp={STORAGE_SIZE_HELP} containerDetails={false}
                                            onChange={updates => onUpdate(index, updates)} onSwitchType={type => onSwitchType(index, type)} />
                                    </Box>
                                </EntityRowTop>
                                {isContainerChest(chest) && <EntitySettings actionContainerId={settingsSlotId('chest', chest.id)} label={label}
                                    summary={<ContainerChestSummary chest={chest} />}>
                                    <ContainerChestFields chest={chest} itemNames={itemNames} dialog onChange={updates => onUpdate(index, updates)} />
                                </EntitySettings>}
                            </>}
                        </EntityRow>;
                    })}
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
