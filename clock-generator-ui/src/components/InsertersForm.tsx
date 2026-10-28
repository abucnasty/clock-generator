import { useCraftingMachines } from '../hooks/useCraftingMachines';
import { InserterIcon } from './InserterIcon';
import { EntitySettings } from './EntitySettings';
import { effectiveInserterStackSize, inserterTimingLabels } from '../utils/inserterMetadata';
import { ArrowDownward, ArrowUpward } from '@mui/icons-material';
import {
    Box,
    Button,
    Checkbox,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMemo, useState, useCallback, useEffect, useRef, memo, type MouseEvent } from 'react';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { useEntityRows } from '../hooks/useEntityRows';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { PanelSection } from './Panel';
import { EnableControlFormContent, type CopyFromOption } from './EnableControlModal';
import { enableControlOverrideChanged } from '../utils/enableControlDraft';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { SortableList } from './SortableList';
import { AddButton } from './AddRow';
import { EntityRow, EntityRowActions } from './EntityRow';
import { entityLabel, settingsSlotId } from '../utils/entityLabel';
import { inferInserterItems, itemsAround } from '../utils/inferInserterItems';
import { InserterEditor, type InserterEditorProps } from './InserterEditor';
import { entityOptionsOf } from '../utils/inserterOptions';
import { BulkEditBar } from './BulkEditBar';
import { itemsUnion, pruneSelection, rangeSelect } from '../utils/bulkEdit';
import { sourceItemsOf } from '../utils/inferInserterItems';
import { selectRowName } from '../utils/a11yLabels';
import { describeBulkEdit, type BulkEditKind } from '../utils/undoSnapshot';
import { usesAutomaticFilters } from '../utils/inserterFilters';
import { describeEnableRule } from '../utils/enableRuleLabel';

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

const InserterRow = memo(function InserterRow({ fullMetadata, focusRequest, value, index, onUpdate, onRemove, ruleCopySources, count, onDuplicate, onReorder, selecting, checked, onSelect, ...editor }: Omit<InserterEditorProps, 'layout' | 'label' | 'onChange' | 'rowActions'> & {
    focusRequest?: InsertersFormProps['focusRequest'];
    fullMetadata: string;
    index: number;
    count: number;
    onDuplicate: (index: number) => void;
    onReorder: InsertersFormProps['onReorder'];
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
    const filterItems = usesAutomaticFilters(value.filters) ? inferInserterItems(value, editor.machines, editor.belts, editor.chests, editor.getRecipeInfo, editor.inserters, craftingMachines, editor.drills) : value.filters?.filter(Boolean) ?? [];
    return <EntityRow kind="inserter" row={value} label={label} icon={<InserterIcon value={value} size={28} />} data-selected={selectedRow ? 'true' : undefined}
        sx={selectedRow ? {
            bgcolor: (theme: Theme) => themeTokens(theme).hover.row,
            boxShadow: (theme: Theme) => `inset 0 0 0 1px ${themeTokens(theme).control.border}, inset 4px 0 0 ${themeTokens(theme).text.secondary}`,
        } : undefined}>
        {dragHandle =>
            <InserterEditor {...editor} value={value} label={label} layout="workbench" onChange={onChange}
                routeSummary={<Typography variant="caption">
                    Stack {Number.isFinite(effectiveInserterStackSize(value)) ? effectiveInserterStackSize(value) : 'unavailable'} · {value._forced_always ? 'Always on (forced)' : describeEnableRule(value.overrides?.enable_control).chip}
                </Typography>}
                identity={<>
                    {selecting && <Checkbox checked={checked} onClick={event => onSelect(value._uuid, event)}
                        slotProps={{ input: { 'aria-label': selectRowName(label) } }} sx={{ p: 0.5 }} />}
                    {dragHandle}
                    <Box sx={{ display: 'flex', flexDirection: 'column', ml: 0.25 }}>
                        <Tooltip title="Move up"><span><IconButton size="small" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => onReorder(index, index - 1)} sx={{ p: 0.375 }}><ArrowUpward sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
                        <Tooltip title="Move down"><span><IconButton size="small" disabled={index === count - 1} aria-label={`Move ${label} down`} onClick={() => onReorder(index, index + 1)} sx={{ p: 0.375 }}><ArrowDownward sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>
                    </Box>
                </>}
                routeActions={<EntityRowActions kind="inserter" id={value.id} label={label} index={index} count={count} onDuplicate={onDuplicate} onDelete={onRemove} />}
                rowSettings={fields => <EntitySettings actionContainerId={settingsSlotId('inserter', value.id)} label={label} request={detailsRequest}
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
                summary={null}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{fullMetadata}</Typography>
                {fields}
            </EntitySettings>} />}
    </EntityRow>;
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

    const { cardRef, add: addRow, duplicate, remove } = useEntityRows(inserters, {
        labelOf: row => entityLabel('inserter', row.id), onRemove, onDuplicate,
        duplicateRefusal: (row, label) => row.sink.drop === undefined ? null
            : `${label} cannot be duplicated: its imported drop position belongs to one inserter. Edit and reopen the build file to supply another position.`,
    });
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
    const add = () => addRow(onAdd);
    // Appending a route must not replace every row's action props or copy-from options.
    const ruleCopyKey = JSON.stringify(inserters.filter(row => row.overrides?.enable_control && row.overrides.enable_control.mode !== 'AUTO')
        .map(row => ({ uuid: row._uuid, label: entityLabel('inserter', row.id), override: row.overrides!.enable_control! })));
    const ruleCopySources = useMemo(() => JSON.parse(ruleCopyKey) as RuleCopySource[], [ruleCopyKey]);

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
                    <AddButton id="add-inserter" label="Add Inserter" onClick={add} />
                </>
            )}
        >

            {selecting && <BulkEditBar selected={selectedRows} total={inserters.length} priorityIds={priorityIds} availableItems={bulkItems} itemNames={itemNames}
                onSelectAll={() => setSelection(new Set(inserters.map(row => row._uuid)))} onClear={clearSelection} onDone={finishBulkEdit} onReturnFocus={returnSelectionFocus} onApply={apply} />}
            <SortableList itemKeys={itemKeys} onReorder={onReorder}>
            {inserters.map((inserter, index) => (
                <InserterRow key={inserter._uuid} focusRequest={focusRequest?.id === inserter.id ? focusRequest : null} fullMetadata={`${typeText(inserter)} · ${qualityText(inserter)}`} value={inserter} index={index} inserters={inserters} machines={machines} belts={belts} chests={chests} drills={drills} itemNames={itemNames} getRecipeInfo={getRecipeInfo} options={options} onUpdate={onUpdate} onRemove={remove} ruleCopySources={ruleCopySources}
                    count={inserters.length} onDuplicate={duplicate} onReorder={onReorder}
                    selecting={selecting} checked={selected.has(inserter._uuid)} onSelect={selectRow} />
            ))}
            </SortableList>

            {inserters.length > 0 && <AddButton label="Add Inserter" fullWidth onClick={add} />}

            {inserters.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                    No inserters configured. Add at least one inserter to move items.
                </Typography>
            )}


        </PanelSection>
    );
}

export const InsertersForm = memo(InsertersFormComponent);
