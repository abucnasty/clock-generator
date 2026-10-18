import { EntityBadge } from './EntityBadge';
import { InserterIcon } from './InserterIcon';
import { EntitySettings } from './EntitySettings';
import { effectiveInserterStackSize, inserterTimingLabels } from '../utils/inserterMetadata';
import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    Checkbox,
    IconButton,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef, memo, type MouseEvent } from 'react';
import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
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
import { FilterSlotSelector } from './FilterSlotSelector';
import { entityOptionsOf, findOption } from '../utils/inserterOptions';
import { RowActionsMenu } from './RowActionsMenu';
import { BulkEditBar } from './BulkEditBar';
import { useAnnounce } from '../hooks/useMessages';
import { itemsUnion, pruneSelection, rangeSelect } from '../utils/bulkEdit';
import { sourceItemsOf } from '../utils/inferInserterItems';
import { selectRowName } from '../utils/a11yLabels';
import { describeBulkEdit, type BulkEditKind } from '../utils/undoSnapshot';
import { removeFilterSlot, setFilterSlot, usesAutomaticFilters } from '../utils/inserterFilters';
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

const InserterRow = memo(function InserterRow({ filterView, fullMetadata, value, index, onUpdate, onRemove, ruleCopySources, onDuplicate, onReorder, canMoveDown, selecting, checked, onSelect, ...editor }: Omit<InserterEditorProps, 'layout' | 'label' | 'onChange' | 'rowActions'> & {
    filterView: boolean;
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
    ruleCopySources: RuleCopySource[];
}) {
    const onChange = useCallback((updates: Partial<InserterFormData>) => onUpdate(index, updates), [index, onUpdate]);
    const [ruleRevision, setRuleRevision] = useState(0);
    const ruleCopyOptions = useMemo(() => ruleCopySources.filter(source => source.uuid !== value._uuid), [ruleCopySources, value._uuid]);
    const label = entityLabel('inserter', value.id);
    const { itemLabel } = useGameNames();
    const selectedRow = selecting && checked;
    const selectionStyle = {
        bgcolor: (theme: Theme) => selectedRow ? themeTokens(theme).hover.row : themeTokens(theme).surface.row,
        boxShadow: (theme: Theme) => selectedRow ? `inset 0 0 0 1px ${themeTokens(theme).control.border}, inset 4px 0 0 ${themeTokens(theme).text.secondary}` : undefined,
    };
    const filterItems = usesAutomaticFilters(value.filters) ? inferInserterItems(value, editor.machines, editor.belts, editor.chests, editor.getRecipeInfo) : value.filters?.filter(Boolean) ?? [];
    if (filterView) return <SortableItem stableKey={value._uuid} label={label} displayLabel={<EntityBadge id={value.id}><InserterIcon value={value} size={28} /></EntityBadge>}>
        {dragHandle => <Box id={`entity-inserter-${value.id}`} role="group" aria-label={label}
            data-selected={selectedRow ? 'true' : undefined}
            sx={{ p: 1.5, minWidth: 0, ...selectionStyle, containerType: 'inline-size', containerName: 'filter-row' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 1.5, alignItems: 'center', '@container filter-row (max-width: 500px)': { gridTemplateColumns: 'auto minmax(0, 1fr)' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {selecting && <Checkbox checked={checked} onClick={event => onSelect(value._uuid, event)} slotProps={{ input: { 'aria-label': selectRowName(label) } }} sx={{ p: 0.5 }} />}
                    {dragHandle}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {findOption(editor.options ?? [], value.source.type, value.source.id)?.label ?? entityLabel(value.source.type, value.source.id)} → {findOption(editor.options ?? [], value.sink.type, value.sink.id)?.label ?? entityLabel(value.sink.type, value.sink.id)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{usesAutomaticFilters(value.filters) ? 'Automatic' : 'Explicit filters'}</Typography>
                    {!usesAutomaticFilters(value.filters) && <Button size="small" color="inherit" sx={{ ml: 0.5, py: 0, minWidth: 0 }} onClick={() => onChange({ filters: undefined })}>Use auto</Button>}
                </Box>
                <Box data-row-first="" sx={{ minWidth: 0, '@container filter-row (max-width: 500px)': { gridColumn: 2 } }}>
                    <FilterSlotSelector filters={value.filters} inferredFilters={filterItems} itemNames={editor.itemNames}
                        priority={{ label: 'From source', ids: sourceItemsOf(value.source, editor.machines, editor.belts, editor.chests, editor.getRecipeInfo) }}
                        onFilterChange={(slot, item) => onChange({ filters: setFilterSlot(value.filters, filterItems.slice(0, 5), slot, item).filters })}
                        onRemoveFilter={slot => onChange({ filters: removeFilterSlot(value.filters, filterItems.slice(0, 5), slot).filters })} />
                </Box>
            </Box>
        </Box>}
    </SortableItem>;
    return <SortableItem stableKey={value._uuid} label={label} displayLabel={<EntityBadge id={value.id}><InserterIcon value={value} size={28} /></EntityBadge>}>
        {dragHandle => <Box id={`entity-inserter-${value.id}`} role="group" aria-label={label} data-selected={selectedRow ? 'true' : undefined} sx={{
            ...ROW_GRID_SX, p: 1.5, pt: 1.5, ...selectionStyle,
        }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) auto', gap: 1, alignItems: 'center',
                '@container inserter-row (max-width: 650px)': { gridTemplateColumns: 'minmax(0, 1fr) auto' } }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', gridColumn: 1, gridRow: 1, '& .MuiChip-root': { height: 40, bgcolor: 'transparent', '& .MuiChip-label': { px: 0 } } }}>
                    {selecting && <Checkbox checked={checked} onClick={event => onSelect(value._uuid, event)}
                        slotProps={{ input: { 'aria-label': selectRowName(label) } }} sx={{ p: 0.5 }} />}
                    {dragHandle}
                </Box>
            <Box sx={{ display: 'contents', '@container inserter-row (max-width: 650px)': { '& > div:nth-of-type(-n+2)': { gridColumn: '1 / -1' } } }}>
                <InserterEditor {...editor} value={value} label={label} layout="row" onChange={onChange}
                    routeActions={<Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gridColumn: 4, gridRow: 1, '@container inserter-row (max-width: 650px)': { gridColumn: 2 } }}>
                        <Box id={`settings-actions-inserter-${value.id}`} sx={{ display: 'flex' }} />
                        <RowActionsMenu label={label} onDuplicate={() => onDuplicate(index, label)}
                            onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                            onMoveDown={canMoveDown ? () => onReorder(index, index + 1) : undefined} />
                        <IconButton onClick={() => onRemove(index)} color="error" aria-label={deleteButtonLabel('inserter', value.id)} data-row-delete=""><Delete /></IconButton>
                    </Box>}
                    rowSettings={fields => <EntitySettings actionContainerId={`settings-actions-inserter-${value.id}`} label={label} tabs={[{ label: 'Enable control', content:
                        <EnableControlFormContent key={ruleRevision + JSON.stringify(value.overrides?.enable_control)} entityType="inserter" entityId={value.id}
                            currentOverride={value.overrides?.enable_control} sourceType={value.source.type} sinkType={value.sink.type}
                            availableItems={itemsAround(value, editor.machines, editor.belts, editor.chests, editor.getRecipeInfo)}
                            movedItems={filterItems} stackSize={effectiveInserterStackSize(value)} copyFromOptions={ruleCopyOptions}
                            onCancel={() => setRuleRevision(previous => previous + 1)}
                            onSave={override => {
                                if (enableControlOverrideChanged(override, value.overrides?.enable_control)) onChange({ overrides: { ...value.overrides, enable_control: override } });
                                setRuleRevision(previous => previous + 1);
                            }} />
                    }]} summary={<Typography variant="body2">
                        Stack {effectiveInserterStackSize(value)}{value.stack_size === undefined ? ' (automatic)' : ' (explicit)'} · Filters: {usesAutomaticFilters(value.filters) ? 'Auto' : 'Explicit'}{filterItems.length ? ` (${filterItems.map(itemLabel).join(', ')})` : ' (none)'} · {value._forced_always ? 'Always on (forced)' : describeEnableRule(value.overrides?.enable_control).chip}
                        {value.source.type === 'belt' && value.source.near_lane !== undefined && ` · Nearest lane ${value.source.near_lane}`}
                        {value.prototype !== undefined && ` · ${inserterTimingLabels(value).type}`}
                        {value.quality !== undefined && ` · ${inserterTimingLabels(value).quality}`}
                    </Typography>}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{fullMetadata}</Typography>
                        {fields}
                    </EntitySettings>}
                />
            </Box>
            </Box>
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

    const options = useMemo(() => entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }), [machines, belts, chests, itemLabel, recipeLabel]);


    const { cardRef, remove, afterAdd } = useFocusAfterRemove(inserters.length, onRemove);
    const announce = useAnnounce();
    const [selecting, setSelecting] = useState(false);
    const [filterView, setFilterView] = useState(focusRequest?.filters ?? false);
    const [lastFocusRequest, setLastFocusRequest] = useState(focusRequest);
    if (lastFocusRequest !== focusRequest) {
        setLastFocusRequest(focusRequest);
        if (focusRequest) setFilterView(focusRequest.filters);
    }
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
    const priorityIds = useMemo(() => itemsUnion(selectedRows.map(row => sourceItemsOf(row.source, machines, belts, chests, getRecipeInfo))), [selectedRows, machines, belts, chests, getRecipeInfo]);
    const bulkItems = useMemo(() => itemsUnion(selectedRows.map(row => itemsAround(row, machines, belts, chests, getRecipeInfo))), [selectedRows, machines, belts, chests, getRecipeInfo]);
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
                    Routes choose each inserter's source and destination. Filters edit the items it carries.
                    Automatic filters follow the source and destination; clearing the last explicit filter returns to Automatic.
                    Open an inserter's settings to edit its stack size and enable rule, or use Bulk edit for several inserters.
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
                    <ToggleButtonGroup value={filterView ? 'filters' : 'routes'} exclusive size="small" color="standard" aria-label="Inserter view"
                        onChange={(_, view: string | null) => { if (view) setFilterView(view === 'filters'); }}>
                        <ToggleButton value="routes" sx={{ px: 1, py: 0.5 }}>Routes</ToggleButton>
                        <ToggleButton value="filters" sx={{ px: 1, py: 0.5 }}>Filters</ToggleButton>
                    </ToggleButtonGroup>
                    <Button ref={selectRef} aria-pressed={selecting} color="inherit" variant={selecting ? 'outlined' : 'text'} size="small" sx={{ bgcolor: selecting ? 'action.selected' : undefined }}
                        onClick={() => { if (selecting) finishBulkEdit(); else setSelecting(true); }}>Bulk edit</Button>
                    <Button startIcon={<Add />} color="inherit" onClick={add} variant="text" size="small" data-row-add="">Add Inserter</Button>
                </>
            )}
        >

            {selecting && <BulkEditBar filtersOnly={filterView} selected={selectedRows} total={inserters.length} priorityIds={priorityIds} availableItems={bulkItems} itemNames={itemNames}
                onSelectAll={() => setSelection(new Set(inserters.map(row => row._uuid)))} onClear={clearSelection} onDone={finishBulkEdit} onReturnFocus={returnSelectionFocus} onApply={apply} />}
            <Box sx={{ ...LIST_GRID_SX, rowGap: 1 }}>
            <SortableList itemKeys={itemKeys} onReorder={onReorder}>
            {inserters.map((inserter, index) => (
                <InserterRow key={inserter._uuid} filterView={filterView} fullMetadata={`${typeText(inserter)} · ${qualityText(inserter)}`} metadata={[!commonType ? typeText(inserter) : null, !commonQuality ? qualityText(inserter) : null].filter(Boolean).join(' · ')} value={inserter} index={index} machines={machines} belts={belts} chests={chests} itemNames={itemNames} getRecipeInfo={getRecipeInfo} options={options} onUpdate={onUpdate} onRemove={removeRow} ruleCopySources={ruleCopySources}
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


        </PanelSection>
    );
}

export const InsertersForm = memo(InsertersFormComponent);
