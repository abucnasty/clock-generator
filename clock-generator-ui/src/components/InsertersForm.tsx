import { EntityBadge } from './EntityBadge';
import { useCraftingMachines } from '../hooks/useCraftingMachines';
import { InserterIcon } from './InserterIcon';
import { EntitySettings } from './EntitySettings';
import { effectiveInserterStackSize, inserterTimingLabels } from '../utils/inserterMetadata';
import { Add, ArrowDownward, ArrowUpward, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    Checkbox,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef, memo, type MouseEvent } from 'react';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { PanelSection } from './Panel';
import { EnableControlFormContent, type CopyFromOption } from './EnableControlModal';
import { enableControlOverrideChanged } from '../utils/enableControlDraft';
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

const LIST_GRID_SX = {
    display: 'grid',
    rowGap: 2,
    '& > *': { minWidth: 0 },
};
const ROW_GRID_SX = {
    minWidth: 0,
    containerType: 'inline-size',
    containerName: 'inserter-row',
    p: 2,
    pt: 2.5,
    bgcolor: (theme: Theme) => themeTokens(theme).surface.row,
};
interface InsertersFormProps {
    focusRequest?: { id: number; filters: boolean; pickup?: boolean } | null;
    onFocusHandled?: () => void;
    inserters: InserterFormData[];
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    /** The drills: a container holds what the ones that drop into it mine */
    drills?: readonly DrillFormData[];
    itemNames: string[];
    getRecipeInfo: (recipeName: string) => RecipeInfo | null;
    onAdd: () => void;
    onUpdate: (index: number, updates: Partial<InserterFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onDuplicate: (index: number) => void;
    onBulkUpdate: (uuids: string[], updates: Partial<InserterFormData>, message: string) => void;
}

type RuleCopySource = CopyFromOption & { uuid: string };

const InserterRow = memo(function InserterRow({ fullMetadata, focusRequest, value, index, onUpdate, onRemove, ruleCopySources, onDuplicate, onReorder, canMoveDown, selecting, checked, onSelect, ...editor }: Omit<InserterEditorProps, 'layout' | 'label' | 'onChange' | 'rowActions'> & {
    focusRequest?: InsertersFormProps['focusRequest'];
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
    ruleCopySources: RuleCopySource[];
}) {
    const onChange = useCallback((updates: Partial<InserterFormData>) => onUpdate(index, updates), [index, onUpdate]);
    const [ruleRevision, setRuleRevision] = useState(0);
    const ruleCopyOptions = useMemo(() => ruleCopySources.filter(source => source.uuid !== value._uuid), [ruleCopySources, value._uuid]);
    const label = entityLabel('inserter', value.id);
    const craftingMachines = useCraftingMachines();
    const detailsRequest = useMemo(() => focusRequest?.pickup ? { tab: 'General' } : undefined, [focusRequest]);
    const selectedRow = selecting && checked;
    const selectionStyle = {
        bgcolor: (theme: Theme) => selectedRow ? themeTokens(theme).hover.row : themeTokens(theme).surface.row,
        boxShadow: (theme: Theme) => selectedRow ? `inset 0 0 0 1px ${themeTokens(theme).control.border}, inset 4px 0 0 ${themeTokens(theme).text.secondary}` : undefined,
    };
    const filterItems = usesAutomaticFilters(value.filters) ? inferInserterItems(value, editor.machines, editor.belts, editor.chests, editor.getRecipeInfo, editor.inserters, craftingMachines, editor.drills) : value.filters?.filter(Boolean) ?? [];
    return <SortableItem stableKey={value._uuid} label={label} displayLabel={<EntityBadge id={value.id}><InserterIcon value={value} size={28} /></EntityBadge>}>
        {dragHandle => <Box id={`entity-inserter-${value.id}`} role="group" aria-label={label} data-selected={selectedRow ? 'true' : undefined} sx={{
            ...ROW_GRID_SX, p: 1.5, pt: 1.5, ...selectionStyle,
        }}>
            <InserterEditor {...editor} value={value} label={label} layout="workbench" onChange={onChange}
                identity={<>
                    {selecting && <Checkbox checked={checked} onClick={event => onSelect(value._uuid, event)}
                        slotProps={{ input: { 'aria-label': selectRowName(label) } }} sx={{ p: 0.5 }} />}
                    {dragHandle}
                    <Box sx={{ display: 'flex', flexDirection: 'column', ml: 0.25 }}>
                        <Tooltip title="Move up"><span><IconButton size="small" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => onReorder(index, index - 1)} sx={{ p: 0.375 }}><ArrowUpward sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
                        <Tooltip title="Move down"><span><IconButton size="small" disabled={!canMoveDown} aria-label={`Move ${label} down`} onClick={() => onReorder(index, index + 1)} sx={{ p: 0.375 }}><ArrowDownward sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
                    </Box>
                </>}
                routeActions={<>
                    <Box id={`settings-actions-inserter-${value.id}`} sx={{ display: 'flex' }} />
                    <RowActionsMenu label={label} onDuplicate={() => onDuplicate(index, label)} showReorder={false} />
                    <IconButton onClick={() => onRemove(index)} color="error" aria-label={deleteButtonLabel('inserter', value.id)} data-row-delete=""><Delete /></IconButton>
                </>}
                rowSettings={fields => <EntitySettings actionContainerId={`settings-actions-inserter-${value.id}`} label={label} request={detailsRequest}
                tabs={[{ label: 'Enable control', content:
                    <EnableControlFormContent key={ruleRevision + JSON.stringify(value.overrides?.enable_control)} entityType="inserter" entityId={value.id}
                        currentOverride={value.overrides?.enable_control} sourceType={value.source.type} sinkType={value.sink.type}
                        availableItems={itemsAround(value, editor.machines, editor.belts, editor.chests, editor.getRecipeInfo, editor.inserters, craftingMachines, editor.drills)}
                        movedItems={filterItems} stackSize={effectiveInserterStackSize(value)} copyFromOptions={ruleCopyOptions}
                        onCancel={() => setRuleRevision(previous => previous + 1)}
                        onSave={override => {
                            if (enableControlOverrideChanged(override, value.overrides?.enable_control)) onChange({ overrides: { ...value.overrides, enable_control: override } });
                            setRuleRevision(previous => previous + 1);
                        }} />
                }]}
                summary={<Typography variant="caption">
                    Stack {Number.isFinite(effectiveInserterStackSize(value)) ? effectiveInserterStackSize(value) : 'unavailable'} · {value._forced_always ? 'Always on (forced)' : describeEnableRule(value.overrides?.enable_control).chip}
                </Typography>}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{fullMetadata}</Typography>
                {fields}
            </EntitySettings>} />
        </Box>}
    </SortableItem>;
});

function InsertersFormComponent({
    focusRequest,
    onFocusHandled,
    inserters,
    machines,
    belts,
    chests,
    drills,
    itemNames,
    getRecipeInfo,
    onAdd,
    onUpdate,
    onRemove,
    onReorder,
    onDuplicate,
    onBulkUpdate,
}: InsertersFormProps) {
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
    const { itemLabel, recipeLabel } = useGameNames();

    const options = useMemo(() => entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }, { inserters, getRecipeInfo, drills }), [machines, belts, chests, itemLabel, recipeLabel, inserters, getRecipeInfo, drills]);


    const { cardRef, remove, afterAdd } = useFocusAfterRemove(inserters.length, onRemove);
    const announce = useAnnounce();
    const [selecting, setSelecting] = useState(false);
    const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
    const selected = pruneSelection(selection, inserters.map(row => row._uuid));
    if (selected !== selection) setSelection(selected);
    const anchor = useRef<string | null>(null);
    const selectRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!focusRequest) return;
        const frame = requestAnimationFrame(() => {
            const row = document.getElementById(`entity-inserter-${focusRequest.id}`);
            const control = row?.querySelector<HTMLElement>(focusRequest.pickup ? '[data-pickup-type] [role="combobox"]'
                : focusRequest.filters ? 'button[aria-haspopup="dialog"]' : '[role="combobox"]');
            control?.focus();
            row?.scrollIntoView({ block: 'center' });
            onFocusHandled?.();
        });
        return () => cancelAnimationFrame(frame);
    }, [focusRequest, onFocusHandled]);
    const selectedRows = useMemo(() => inserters.filter(row => selected.has(row._uuid)), [inserters, selected]);
    const craftingMachines = useCraftingMachines();
    const priorityIds = useMemo(() => itemsUnion(selectedRows.map(row => sourceItemsOf(row.source, machines, belts, chests, getRecipeInfo, inserters, drills))), [selectedRows, machines, belts, chests, getRecipeInfo, inserters, drills]);
    const bulkItems = useMemo(() => itemsUnion(selectedRows.map(row => itemsAround(row, machines, belts, chests, getRecipeInfo, inserters, craftingMachines, drills))), [selectedRows, machines, belts, chests, getRecipeInfo, inserters, craftingMachines, drills]);
    const itemKeys = useMemo(() => inserters.map(row => row._uuid), [inserters]);
    const rowOrder = useRef(itemKeys);
    useEffect(() => { rowOrder.current = itemKeys; }, [itemKeys]);
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
    const finishBulkEdit = () => { clearSelection(); setSelecting(false); };
    const apply = (updates: Partial<InserterFormData>, kind: BulkEditKind) => {
        if (selectedRows.length === 0) return;
        const detail = kind === 'stack' ? updates.stack_size ?? 'Automatic'
            : kind === 'rule' ? describeEnableRule(updates.overrides?.enable_control).chip.replace(/^Enable: /, '') : undefined;
        onBulkUpdate(selectedRows.map(row => row._uuid), updates, describeBulkEdit(kind, selectedRows.map(row => row.id), detail));
    };
    const addedLabel = () => entityLabel('inserter', Math.max(0, ...inserters.map(row => row.id)) + 1);
    const add = () => { afterAdd(onAdd); announce(`Added ${addedLabel()}.`); };
    // Appending a route must not replace every row's action props or copy-from options.
    const ruleCopyKey = JSON.stringify(inserters.filter(row => row.overrides?.enable_control && row.overrides.enable_control.mode !== 'AUTO')
        .map(row => ({ uuid: row._uuid, label: entityLabel('inserter', row.id), override: row.overrides!.enable_control! })));
    const ruleCopySources = useMemo(() => JSON.parse(ruleCopyKey) as RuleCopySource[], [ruleCopyKey]);
    const actionsRef = useRef({ inserters, remove, afterAdd, onDuplicate, announce });
    useLayoutEffect(() => { actionsRef.current = { inserters, remove, afterAdd, onDuplicate, announce }; }, [inserters, remove, afterAdd, onDuplicate, announce]);
    const removeRow = useCallback((index: number) => actionsRef.current.remove(index), []);
    const duplicate = useCallback((index: number, label: string) => {
        const actions = actionsRef.current;
        if (actions.inserters[index]?.sink.drop !== undefined) {
            actions.announce(`${label} cannot be duplicated: its imported drop position belongs to one inserter. Edit and reopen the build file to supply another position.`);
            return;
        }
        const addedId = Math.max(0, ...actions.inserters.map(row => row.id)) + 1;
        actions.afterAdd(() => actions.onDuplicate(index));
        actions.announce(`Added ${entityLabel('inserter', addedId)}, a copy of ${label}.`);
    }, []);

    return (
        <PanelSection
            ref={cardRef}
            level={3}
            title={`Inserters (${inserters.length})`}
            help={{ label: 'About inserters', content: <>
                <Typography variant="body2" sx={{ mb: 1 }}>
                    Edit each inserter's source, item filters and destination in one row. Drag the handle or use Move up and Move down to rearrange inserters.
                    Automatic filters follow the source and destination; clearing the last explicit filter returns to Automatic.
                    Open Entity details to edit an inserter's stack size and enable rule, or use Bulk edit for several inserters.
                </Typography>
                {commonMetadata.length > 0 && <Typography variant="body2" sx={{ mb: 1 }}>All {inserters.length} inserters: {commonMetadata.join(' · ')}.</Typography>}
                {(missingTypes > 0 || missingQualities > 0) && <Typography variant="body2" sx={{ mb: 1 }}>
                    Timing defaults: {missingTypes} missing type → Stack inserter; {missingQualities} missing quality → Legendary.
                </Typography>}
                {automaticStacks > 0 && <Typography variant="body2" sx={{ mb: 1 }}>Automatic stack capacity uses all capacity research ({automaticStacks} of {inserters.length} inserters). Explicit values stay set by hand.</Typography>}
                {(automaticFilters === inserters.length || automaticRules === inserters.length) && inserters.length > 0 && <Typography variant="body2">
                    {automaticFilters === inserters.length && 'All filters: Automatic, from source and destination. '}
                    {automaticRules === inserters.length && 'All enable rules: Auto.'}
                </Typography>}
            </> }}
            actions={(
                <>
                    <Button ref={selectRef} aria-pressed={selecting} color="inherit" variant={selecting ? 'outlined' : 'text'} size="small" sx={{ bgcolor: selecting ? 'action.selected' : undefined }}
                        onClick={() => { if (selecting) finishBulkEdit(); else setSelecting(true); }}>Bulk edit</Button>
                    <Button id="add-inserter" startIcon={<Add />} color="inherit" onClick={add} variant="text" size="small" data-row-add="">Add Inserter</Button>
                </>
            )}
        >

            {selecting && <BulkEditBar selected={selectedRows} total={inserters.length} priorityIds={priorityIds} availableItems={bulkItems} itemNames={itemNames}
                onSelectAll={() => setSelection(new Set(inserters.map(row => row._uuid)))} onClear={clearSelection} onDone={finishBulkEdit} onReturnFocus={returnSelectionFocus} onApply={apply} />}
            <Box sx={{ ...LIST_GRID_SX, rowGap: 1 }}>
            <SortableList itemKeys={itemKeys} onReorder={onReorder}>
            {inserters.map((inserter, index) => (
                <InserterRow key={inserter._uuid} focusRequest={focusRequest?.id === inserter.id ? focusRequest : null} fullMetadata={`${typeText(inserter)} · ${qualityText(inserter)}`} value={inserter} index={index} inserters={inserters} machines={machines} belts={belts} chests={chests} drills={drills} itemNames={itemNames} getRecipeInfo={getRecipeInfo} options={options} onUpdate={onUpdate} onRemove={removeRow} ruleCopySources={ruleCopySources}
                    onDuplicate={duplicate} onReorder={onReorder} canMoveDown={index < inserters.length - 1}
                    selecting={selecting} checked={selected.has(inserter._uuid)} onSelect={selectRow} />
            ))}
            </SortableList>
            </Box>

            {inserters.length > 0 && <Button startIcon={<Add />} fullWidth color="inherit" onClick={add} size="small" sx={{ mt: 1 }} data-row-add="">Add Inserter</Button>}

            {inserters.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    No inserters configured. Add at least one inserter to move items.
                </Typography>
            )}


        </PanelSection>
    );
}

export const InsertersForm = memo(InsertersFormComponent);
