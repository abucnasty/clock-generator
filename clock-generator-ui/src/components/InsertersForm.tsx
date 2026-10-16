import { INSERTER_TIMING_ASSUMPTION, effectiveInserterStackSize, inserterMetadataText } from '../utils/inserterMetadata';
import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    IconButton,
    Typography,
} from '@mui/material';
import { useMemo, useState, useCallback, memo } from 'react';
import type { BeltFormData, ChestFormData, EnableControlOverride, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { SURFACE } from '../theme/tokens';
import { PanelSection } from './Panel';
import { EnableControlModal } from './EnableControlModal';
import { EnableRuleChip } from './EnableRuleChip';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { SortableItem, SortableList } from './SortableList';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
import { inferInserterItems, itemsAround } from '../utils/inferInserterItems';
import { InserterEditor, type InserterEditorProps } from './InserterEditor';
import { entityOptionsOf } from '../utils/inserterOptions';

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
    bgcolor: SURFACE.row,
};
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

const InserterRow = memo(function InserterRow({ value, index, onUpdate, onRemove, onEditRule, ...editor }: Omit<InserterEditorProps, 'layout' | 'label' | 'onChange' | 'rowActions'> & {
    index: number;
    onUpdate: InsertersFormProps['onUpdate'];
    onRemove: (index: number) => void;
    onEditRule: (index: number) => void;
}) {
    const onChange = useCallback((updates: Partial<InserterFormData>) => onUpdate(index, updates), [index, onUpdate]);
    const label = entityLabel('inserter', value.id);
    return <SortableItem stableKey={value._uuid} label={label}>
        {dragHandle => <Box id={`entity-inserter-${value.id}`} role="group" aria-label={label} sx={ROW_GRID_SX}>
            <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>{inserterMetadataText(value)}</Typography>
            {dragHandle}
            <InserterEditor {...editor} value={value} label={label} layout="row" onChange={onChange} rowActions={<>
                <Box sx={{ display: 'flex', minWidth: 0, alignSelf: 'start', mt: '4px' }}>
                    <EnableRuleChip override={value.overrides?.enable_control} entityLabel={label} entityType="inserter" forcedAlways={value._forced_always} onClick={() => onEditRule(index)} />
                </Box>
                <IconButton onClick={() => onRemove(index)} color="error" sx={{ ml: { xs: 'auto', sm: 0 }, alignSelf: 'start' }} aria-label={deleteButtonLabel('inserter', value.id)} data-row-delete=""><Delete /></IconButton>
            </>} />
        </Box>}
    </SortableItem>;
});

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

    const selectedInserter = enableControlModalInserterIndex === null ? undefined : inserters[enableControlModalInserterIndex];

    const { itemLabel, recipeLabel } = useGameNames();

    const options = useMemo(() => entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }), [machines, belts, chests, itemLabel, recipeLabel]);
    const availableItems = useMemo(() => selectedInserter ? itemsAround(selectedInserter, machines, belts, chests, getRecipeInfo) : [], [selectedInserter, machines, belts, chests, getRecipeInfo]);

    const { cardRef, remove } = useFocusAfterRemove(inserters.length, onRemove);

    return (
        <PanelSection
            ref={cardRef}
            level={3}
            title={`Inserters (${inserters.length})`}
            actions={(
                <Button startIcon={<Add />} onClick={onAdd} variant="text" size="small" data-row-add="">
                    Add Inserter
                </Button>
            )}
        >

            {inserters.some(inserter => !inserter.prototype || !inserter.quality) && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{INSERTER_TIMING_ASSUMPTION}</Typography>
            )}
            <Box sx={LIST_GRID_SX}>
            <SortableList itemKeys={inserters.map((ins) => ins._uuid)} itemLabels={inserters.map((ins) => entityLabel('inserter', ins.id))} onReorder={onReorder}>
            {inserters.map((inserter, index) => (
                <InserterRow key={inserter._uuid} value={inserter} index={index} machines={machines} belts={belts} chests={chests} itemNames={itemNames} getRecipeInfo={getRecipeInfo} options={options} onUpdate={onUpdate} onRemove={remove} onEditRule={setEnableControlModalInserterIndex} />
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
                entityId={enableControlModalInserterIndex !== null ? inserters[enableControlModalInserterIndex]?.id ?? 0 : 0}
                stackSize={selectedInserter ? effectiveInserterStackSize(selectedInserter) : undefined}
                movedItems={(() => {
                    const inserter = enableControlModalInserterIndex !== null ? inserters[enableControlModalInserterIndex] : undefined;
                    if (!inserter) return [];
                    // the filters the player set first, else the items the game would pick for it
                    const filters = inserter.filters?.filter(Boolean) ?? [];
                    return filters.length > 0 ? filters : inferInserterItems(inserter, machines, belts, chests, getRecipeInfo);
                })()}
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
                availableItems={availableItems}
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
        </PanelSection>
    );
}

export const InsertersForm = memo(InsertersFormComponent);
