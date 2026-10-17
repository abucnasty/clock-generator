import { INSERTER_TIMING_ASSUMPTION, effectiveInserterStackSize, inserterTimingLabels } from '../utils/inserterMetadata';
import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    Checkbox,
    IconButton,
    Typography,
} from '@mui/material';
import { useMemo, useState, useCallback, useEffect, useRef, memo, type MouseEvent } from 'react';
import type { BeltFormData, ChestFormData, EnableControlOverride, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';
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
import { RowActionsMenu } from './RowActionsMenu';
import { BulkEditBar } from './BulkEditBar';
import { useAnnounce } from '../hooks/useMessages';
import { itemsUnion, pruneSelection, rangeSelect } from '../utils/bulkEdit';
import { sourceItemsOf } from '../utils/inferInserterItems';
import { selectRowName } from '../utils/a11yLabels';
import { describeBulkEdit, type BulkEditKind } from '../utils/undoSnapshot';
import { usesAutomaticFilters } from '../utils/inserterFilters';
import { describeEnableRule } from '../utils/enableRuleLabel';

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
    [ONE_LINE]: { gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) auto auto auto 30px 40px' },
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
    onDuplicate: (index: number) => void;
    onBulkUpdate: (uuids: string[], updates: Partial<InserterFormData>, message: string) => void;
}

const InserterRow = memo(function InserterRow({ compact, metadata, fullMetadata, value, index, onUpdate, onRemove, onEditRule, onDuplicate, onReorder, canMoveDown, selecting, checked, onSelect, ...editor }: Omit<InserterEditorProps, 'layout' | 'label' | 'onChange' | 'rowActions'> & {
    compact: boolean;
    metadata: string;
    fullMetadata: string;
    index: number;
    onDuplicate: (index: number, label: string) => void;
    onReorder: InsertersFormProps['onReorder'];
    canMoveDown: boolean;
    selecting: boolean;
    checked: boolean;
    onSelect: (uuid: string, event: MouseEvent<HTMLButtonElement>) => void;
    onUpdate: InsertersFormProps['onUpdate'];
    onRemove: (index: number) => void;
    onEditRule: (index: number) => void;
}) {
    const onChange = useCallback((updates: Partial<InserterFormData>) => onUpdate(index, updates), [index, onUpdate]);
    const label = entityLabel('inserter', value.id);
    return <SortableItem stableKey={value._uuid} label={label}>
        {dragHandle => <Box id={`entity-inserter-${value.id}`} role="group" aria-label={label} sx={compact ? {
            ...ROW_GRID_SX, p: 1.5, pt: 1.5, rowGap: 1.5, columnGap: 1,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'auto minmax(0, 1fr) minmax(0, 1fr)' },
            [ONE_LINE]: { gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr)' },
        } : ROW_GRID_SX}>
            <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1', overflowWrap: 'anywhere', display: compact && !metadata ? 'none' : undefined }}>{compact ? metadata : fullMetadata}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {selecting && <Checkbox checked={checked} onClick={event => onSelect(value._uuid, event)}
                    slotProps={{ input: { 'aria-label': selectRowName(label) } }} sx={{ p: 0.5 }} />}
                {dragHandle}
            </Box>
            <InserterEditor {...editor} density={compact ? 'compact' : 'explanatory'} value={value} label={label} layout="row" onChange={onChange} rowActions={<>
                <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '100%', flex: compact ? '1 1 140px' : undefined, alignSelf: 'start', mt: '4px', '& .MuiChip-root': { height: 'auto', minHeight: 24 }, '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 } }}>
                    <Typography variant="caption" color="text.secondary">{value.overrides?.enable_control === undefined ? 'Automatic rule' : 'Explicit rule'}</Typography>
                    <EnableRuleChip override={value.overrides?.enable_control} entityLabel={label} entityType="inserter" forcedAlways={value._forced_always} onClick={() => onEditRule(index)} />
                </Box>
                <RowActionsMenu label={label} onDuplicate={() => onDuplicate(index, label)}
                    onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                    onMoveDown={canMoveDown ? () => onReorder(index, index + 1) : undefined} />
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
    onDuplicate,
    onBulkUpdate,
}: InsertersFormProps) {
    const { density } = useDisplayPreferences();
    const compact = density === 'compact';
    const commonType = inserters.length > 0 && inserters.every(row => row.prototype === inserters[0].prototype);
    const commonQuality = inserters.length > 0 && inserters.every(row => row.quality === inserters[0].quality);
    const typeText = (row: InserterFormData) => `Type: ${row.prototype === undefined ? 'Automatic' : 'Explicit'} ${inserterTimingLabels(row).type}`;
    const qualityText = (row: InserterFormData) => `Quality: ${row.quality === undefined ? 'Automatic' : 'Explicit'} ${inserterTimingLabels(row).quality}`;
    const commonMetadata = inserters.length === 0 ? [] : [commonType ? typeText(inserters[0]) : null, commonQuality ? qualityText(inserters[0]) : null].filter(Boolean);
    const missingTypes = inserters.filter(row => row.prototype === undefined).length;
    const missingQualities = inserters.filter(row => row.quality === undefined).length;
    const automaticStacks = inserters.filter(row => row.stack_size === undefined).length;
    const automaticFilters = inserters.filter(row => usesAutomaticFilters(row.filters)).length;
    const automaticRules = inserters.filter(row => row.overrides?.enable_control === undefined).length;
    const [enableControlModalInserterIndex, setEnableControlModalInserterIndex] = useState<number | null>(null);

    const selectedInserter = enableControlModalInserterIndex === null ? undefined : inserters[enableControlModalInserterIndex];

    const { itemLabel, recipeLabel } = useGameNames();

    const options = useMemo(() => entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }), [machines, belts, chests, itemLabel, recipeLabel]);
    const availableItems = useMemo(() => selectedInserter ? itemsAround(selectedInserter, machines, belts, chests, getRecipeInfo) : [], [selectedInserter, machines, belts, chests, getRecipeInfo]);

    const { cardRef, remove, afterAdd } = useFocusAfterRemove(inserters.length, onRemove);
    const announce = useAnnounce();
    const [selecting, setSelecting] = useState(false);
    const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
    const selected = pruneSelection(selection, inserters.map(row => row._uuid));
    if (selected !== selection) setSelection(selected);
    const anchor = useRef<string | null>(null);
    const selectRef = useRef<HTMLButtonElement>(null);
    const selectedRows = useMemo(() => inserters.filter(row => selected.has(row._uuid)), [inserters, selected]);
    const priorityIds = useMemo(() => itemsUnion(selectedRows.map(row => sourceItemsOf(row.source, machines, belts, chests, getRecipeInfo))), [selectedRows, machines, belts, chests, getRecipeInfo]);
    const bulkItems = useMemo(() => itemsUnion(selectedRows.map(row => itemsAround(row, machines, belts, chests, getRecipeInfo))), [selectedRows, machines, belts, chests, getRecipeInfo]);
    const rowOrder = useRef(inserters.map(row => row._uuid));
    useEffect(() => { rowOrder.current = inserters.map(row => row._uuid); }, [inserters]);
    const selectRow = useCallback((uuid: string, event: MouseEvent<HTMLButtonElement>) => {
        setSelection(current => {
            if (event.shiftKey) return rangeSelect(rowOrder.current, anchor.current, uuid, current);
            const next = new Set(current);
            if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
            return next;
        });
        if (!event.shiftKey) anchor.current = uuid;
    }, []);
    const returnSelectionFocus = useCallback(() => { selectRef.current?.focus(); }, []);
    const clearSelection = () => { returnSelectionFocus(); setSelection(new Set()); anchor.current = null; };
    const apply = (updates: Partial<InserterFormData>, kind: BulkEditKind) => {
        const detail = kind === 'stack' ? updates.stack_size ?? 'Automatic'
            : kind === 'rule' ? describeEnableRule(updates.overrides?.enable_control).chip.replace(/^Enable: /, '') : undefined;
        onBulkUpdate(selectedRows.map(row => row._uuid), updates, describeBulkEdit(kind, selectedRows.map(row => row.id), detail));
    };
    const addedLabel = () => entityLabel('inserter', Math.max(0, ...inserters.map(row => row.id)) + 1);
    const add = () => { afterAdd(onAdd); announce(`Added ${addedLabel()}.`); };
    const addedId = Math.max(0, ...inserters.map(row => row.id)) + 1;
    const duplicate = useCallback((index: number, label: string) => {
        if (inserters[index]?.sink.drop !== undefined) {
            announce(`${label} cannot be duplicated: its imported drop position belongs to one inserter. Edit and reopen the build file to supply another position.`);
            return;
        }
        afterAdd(() => onDuplicate(index));
        announce(`Added ${entityLabel('inserter', addedId)}, a copy of ${label}.`);
    }, [afterAdd, onDuplicate, announce, addedId, inserters]);

    return (
        <PanelSection
            ref={cardRef}
            level={3}
            title={`Inserters (${inserters.length})`}
            actions={(
                <>
                    <Button ref={selectRef} aria-pressed={selecting} color={selecting ? 'primary' : 'inherit'} variant={selecting ? 'outlined' : 'text'} size="small"
                        onClick={() => { if (selecting) clearSelection(); setSelecting(!selecting); }}>Select</Button>
                    <Button startIcon={<Add />} onClick={add} variant="text" size="small" data-row-add="">Add Inserter</Button>
                </>
            )}
        >

            {compact && inserters.length > 0 && <Box sx={{ mb: 1 }}>
                {commonMetadata.length > 0 && <Typography variant="body2" color="text.secondary">All {inserters.length} inserters: {commonMetadata.join(' · ')}.</Typography>}
                {(missingTypes > 0 || missingQualities > 0) && <Typography variant="body2" color="text.secondary">
                    Timing defaults: {missingTypes} missing type → Stack inserter; {missingQualities} missing quality → Legendary.
                </Typography>}
                {automaticStacks > 0 && <Typography variant="body2" color="text.secondary">Automatic stack capacity uses all capacity research ({automaticStacks} of {inserters.length} inserters). Explicit values stay set by hand.</Typography>}
                {(automaticFilters === inserters.length || automaticRules === inserters.length) && <Typography variant="body2" color="text.secondary">
                    {automaticFilters === inserters.length && 'All filters: Automatic, from source and destination. '}
                    {automaticRules === inserters.length && 'All enable rules: Auto.'}
                </Typography>}
            </Box>}
            {!compact && inserters.some(inserter => !inserter.prototype || !inserter.quality) && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{INSERTER_TIMING_ASSUMPTION}</Typography>
            )}
            {selectedRows.length > 0 && <BulkEditBar selected={selectedRows} total={inserters.length} priorityIds={priorityIds} availableItems={bulkItems} itemNames={itemNames}
                onSelectAll={() => setSelection(new Set(inserters.map(row => row._uuid)))} onClear={clearSelection} onReturnFocus={returnSelectionFocus} onApply={apply} />}
            <Box sx={compact ? { ...LIST_GRID_SX, rowGap: 1, gridTemplateColumns: 'minmax(0, 1fr)', [ONE_LINE]: { gridTemplateColumns: 'minmax(0, 1fr)' } } : LIST_GRID_SX}>
            <SortableList itemKeys={inserters.map((ins) => ins._uuid)} onReorder={onReorder}>
            {inserters.map((inserter, index) => (
                <InserterRow key={inserter._uuid} compact={compact} fullMetadata={`${typeText(inserter)} · ${qualityText(inserter)}`} metadata={[!commonType ? typeText(inserter) : null, !commonQuality ? qualityText(inserter) : null].filter(Boolean).join(' · ')} value={inserter} index={index} machines={machines} belts={belts} chests={chests} itemNames={itemNames} getRecipeInfo={getRecipeInfo} options={options} onUpdate={onUpdate} onRemove={remove} onEditRule={setEnableControlModalInserterIndex}
                    onDuplicate={duplicate} onReorder={onReorder} canMoveDown={index < inserters.length - 1}
                    selecting={selecting} checked={selected.has(inserter._uuid)} onSelect={selectRow} />
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
