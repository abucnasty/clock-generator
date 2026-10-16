import { INSERTER_TIMING_ASSUMPTION, inserterMetadataText, inserterStackSizeHelp } from '../utils/inserterMetadata';
import {
    Autocomplete,
    Box,
    Button,
    Chip,
    Tab,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import { EnableControlMode, TargetType } from 'clock-generator/light';
import { useId, useLayoutEffect, useMemo, useState } from 'react';
import type {
    BeltFormData,
    ChestFormData,
    InserterFormData,
    MachineFormData,
} from '../hooks/useConfigForm';
import { isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import { useGameNames } from '../hooks/useGameNames';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { describeEnableRule } from '../utils/enableRuleLabel';
import { entityLabel } from '../utils/entityLabel';
import { inferInserterItems } from '../utils/inferInserterItems';
import { changedConfigFields } from '../utils/inserterDraft';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { EnableControlFormContent, type CopyFromOption, type EnableControlFormState } from './EnableControlModal';
import { FactorioIcon } from './FactorioIcon';
import { FilterSlotSelector } from './FilterSlotSelector';
import { NearLaneSelect } from './NearLaneSelect';
import { NumberField } from './NumberField';

// ---- Local types ----

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface EntityOption {
    type: SourceSinkType;
    id: number;
    label: string;
    icon: string;
    sublabel?: string;
    ingredientIcons?: string[];
}

// ---- Inserter config form (source / sink / filters) ----

function InserterEditSection({
    inserter,
    entityIndex,
    machines,
    belts,
    chests,
    itemNames,
    getRecipeInfo,
    onUpdate,
}: {
    inserter: InserterFormData;
    entityIndex: number;
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    onUpdate: (index: number, updates: Partial<InserterFormData>) => void;
}) {
    const { itemLabel, recipeLabel } = useGameNames();
    const entityOptions = useMemo<EntityOption[]>(() => {
        const options: EntityOption[] = [];
        machines.forEach(m => options.push({
            type: TargetType.MACHINE, id: m.id,
            label: entityLabel('machine', m.id),
            icon: m.recipe || 'assembling-machine-3',
            sublabel: m.recipe ? recipeLabel(m.recipe) : 'No recipe',
        }));
        belts.forEach(b => {
            const ingredientIcons = b.lanes.map(l => l.ingredient).filter(Boolean);
            options.push({
                type: TargetType.BELT, id: b.id,
                label: entityLabel('belt', b.id), icon: b.type,
                ingredientIcons: ingredientIcons.length > 0 ? ingredientIcons : undefined,
            });
        });
        chests.forEach(c => options.push({
            type: TargetType.CHEST, id: c.id,
            label: entityLabel('chest', c.id),
            icon: isInfinityChest(c) ? 'infinity-chest' : 'iron-chest',
            sublabel: isBufferChest(c) ? (c.item_filter ? itemLabel(c.item_filter) : 'No filter') : undefined,
        }));
        return options;
    }, [machines, belts, chests, itemLabel, recipeLabel]);

    const findOption = (type: SourceSinkType, id: number) =>
        entityOptions.find(o => o.type === type && o.id === id);

    const inferredFilters = useMemo<string[]>(
        () => inferInserterItems(inserter, machines, belts, chests, getRecipeInfo),
        [inserter, machines, belts, chests, getRecipeInfo],
    );

    const handleFilterChange = (slotIndex: number, item: string) => {
        const filters = [...(inserter.filters || [])];
        filters[slotIndex] = item;
        while (filters.length > 0 && !filters[filters.length - 1]) filters.pop();
        onUpdate(entityIndex, { filters: filters.length > 0 ? filters : undefined });
    };

    const handleRemoveFilter = (slotIndex: number) => {
        let filters = [...(inserter.filters || [])];
        if (filters.length === 0) filters = [...inferredFilters];
        filters.splice(slotIndex, 1);
        while (filters.length > 0 && !filters[filters.length - 1]) filters.pop();
        onUpdate(entityIndex, { filters: filters.length > 0 ? filters : undefined });
    };

    const renderAdornment = (opt: EntityOption | undefined) =>
        opt ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                <FactorioIcon name={opt.icon} size={20} titled />
                {opt.ingredientIcons?.map((ing, i) => <FactorioIcon key={i} name={ing} size={16} titled />)}
            </Box>
        ) : null;

    const renderOption = (props: React.HTMLAttributes<HTMLLIElement> & { key?: string }, option: EntityOption) => {
        const { key, ...rest } = props;
        return (
            <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FactorioIcon name={option.icon} size={24} alt="" />
                <Box>
                    <Typography variant="body2">{option.label}</Typography>
                    {option.sublabel ? (
                        <Typography variant="caption" color="text.secondary">{option.sublabel}</Typography>
                    ) : option.ingredientIcons ? (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {option.ingredientIcons.map((ing, i) => <FactorioIcon key={i} name={ing} size={14} />)}
                        </Box>
                    ) : null}
                </Box>
            </Box>
        );
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Autocomplete
                size="small"
                fullWidth
                options={entityOptions}
                value={findOption(inserter.source.type, inserter.source.id) ?? undefined}
                onChange={(_, v) => v && onUpdate(entityIndex, { source: { type: v.type, id: v.id } })}
                getOptionLabel={(o) => o.sublabel ? `${o.label} - ${o.sublabel}` : o.label}
                isOptionEqualToValue={(o, v) => o.type === v.type && o.id === v.id}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label="Source — Tile 1"
                        slotProps={{ input: { ...params.InputProps, startAdornment: renderAdornment(findOption(inserter.source.type, inserter.source.id)) } }}
                    />
                )}
                renderOption={renderOption}
                autoHighlight
                disableClearable
            />

            <NearLaneSelect source={inserter.source} belts={belts} onChange={(source) => onUpdate(entityIndex, { source })} />
            <Typography variant="body2" color="text.secondary">{inserterMetadataText(inserter)}</Typography>
            {(!inserter.prototype || !inserter.quality) && (
                <Typography variant="body2" color="text.secondary">{INSERTER_TIMING_ASSUMPTION}</Typography>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', px: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                <FactorioIcon name={inserter.prototype ?? 'stack-inserter'} size={22} alt="" />
                <Typography variant="body2" color="text.secondary">
                    {entityLabel('inserter', inserter.id)} — Tile 2
                </Typography>
                <Box sx={{ flex: 1 }} />
                <NumberField
                    id={`diagram-inserter-stack-size-${inserter.id}`}
                    label="Stack size"
                    value={inserter.stack_size ?? null}
                    placeholder="Automatic"
                    helperText={inserterStackSizeHelp(inserter)}
                    onValueChange={(val) => onUpdate(entityIndex, { stack_size: val === null ? undefined : Math.trunc(val) })}
                    min={1}
                    sx={{ width: 180, maxWidth: '100%' }}
                    size="small"
                />
            </Box>

            <Autocomplete
                size="small"
                fullWidth
                options={entityOptions}
                value={findOption(inserter.sink.type, inserter.sink.id) ?? undefined}
                onChange={(_, v) => v && onUpdate(entityIndex, { sink: { type: v.type, id: v.id } })}
                getOptionLabel={(o) => o.sublabel ? `${o.label} - ${o.sublabel}` : o.label}
                isOptionEqualToValue={(o, v) => o.type === v.type && o.id === v.id}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label="Destination — Tile 3"
                        slotProps={{ input: { ...params.InputProps, startAdornment: renderAdornment(findOption(inserter.sink.type, inserter.sink.id)) } }}
                    />
                )}
                renderOption={renderOption}
                autoHighlight
                disableClearable
            />

            <FilterSlotSelector
                filters={inserter.filters}
                inferredFilters={inferredFilters}
                itemNames={itemNames}
                onFilterChange={handleFilterChange}
                onRemoveFilter={handleRemoveFilter}
            />
        </Box>
    );
}

// ---- Panel props ----

interface InserterConfigPanelProps {
    inserter: InserterFormData;
    entityIndex: number;
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    /** Called once, on Save, with the changed fields */
    onUpdate: (index: number, updates: Partial<InserterFormData>) => void;
    /** Closes the dialog the panel is in: after Save, and on Cancel */
    onClose: () => void;
    /** Told whether either tab has unsaved changes; pass a stable function (a state setter) */
    onDirtyChange?: (dirty: boolean) => void;
}

// ---- Tab label with the unsaved mark ----

/** The tab's text, then "•" when it holds unsaved edits; the tab's name says so in words ("Overrides, unsaved changes") */
function TabLabel({ text, unsaved }: { text: string; unsaved: boolean }) {
    if (!unsaved) return <span>{text}</span>;
    // the whole name in one hidden span: next to the visible text, Chrome would put a space before its comma
    return (
        <span>
            <span aria-hidden>
                {text}
                <Box component="span" sx={{ ml: 0.5 }}>•</Box>
            </span>
            <Box component="span" sx={VISUALLY_HIDDEN}>{text}, unsaved changes</Box>
        </span>
    );
}

// ---- Exported panel ----

/**
 * The diagram's inserter editor: a Config tab and an Overrides (rule) tab that make one form. Both edit a draft, which
 * reaches the config only on Save; Cancel drops it. Both tabs stay mounted, so switching between them loses nothing.
 */
export function InserterConfigPanel({
    inserter,
    entityIndex,
    machines,
    inserters,
    belts,
    chests,
    itemNames,
    getRecipeInfo,
    onUpdate,
    onClose,
    onDirtyChange,
}: InserterConfigPanelProps) {
    const id = useId();
    const [activeTab, setActiveTab] = useState(0);
    const [draft, setDraft] = useState(inserter);
    const [rule, setRule] = useState<EnableControlFormState>({ override: inserter.overrides?.enable_control, changed: false });

    // the tab's chip shows the saved rule, in the words of the List row's chip
    const currentOverride = inserter.overrides?.enable_control;
    const savedRule = describeEnableRule(currentOverride, { forcedAlways: inserter._forced_always });

    const availableItems = useMemo<string[]>(() => {
        const items = new Set<string>();
        const addFromEntity = (type: SourceSinkType, id: number) => {
            if (type === TargetType.MACHINE) {
                const m = machines.find(m => m.id === id);
                if (m?.recipe) {
                    const info = getRecipeInfo(m.recipe);
                    info?.results.forEach(r => items.add(r));
                    info?.ingredients.forEach(i => items.add(i));
                }
            } else if (type === TargetType.BELT) {
                const b = belts.find(b => b.id === id);
                b?.lanes.forEach(l => { if (l.ingredient) items.add(l.ingredient); });
            } else if (type === TargetType.CHEST) {
                const c = chests.find(c => c.id === id);
                if (c) {
                    if (isBufferChest(c) && c.item_filter) items.add(c.item_filter);
                    else if (isInfinityChest(c)) c.item_filter.forEach(f => { if (f.item_name) items.add(f.item_name); });
                }
            }
        };
        addFromEntity(draft.source.type, draft.source.id);
        addFromEntity(draft.sink.type, draft.sink.id);
        return [...items];
    }, [draft.source, draft.sink, machines, belts, chests, getRecipeInfo]);

    const copyFromOptions = useMemo<CopyFromOption[]>(() => {
        return inserters
            .filter(ins =>
                ins.id !== inserter.id &&
                ins.overrides?.enable_control?.mode &&
                ins.overrides.enable_control.mode !== EnableControlMode.AUTO,
            )
            .map(ins => ({
                label: entityLabel('inserter', ins.id),
                override: ins.overrides!.enable_control!,
            }));
    }, [inserter.id, inserters]);

    const changedFields = useMemo(() => changedConfigFields(draft, inserter), [draft, inserter]);
    const configDirty = Object.keys(changedFields).length > 0;
    const dirty = rule.changed || configDirty;

    // a layout effect, like the rule form's, so that an Esc right after an edit already asks
    useLayoutEffect(() => {
        onDirtyChange?.(dirty);
        return () => onDirtyChange?.(false);
    }, [dirty, onDirtyChange]);

    const handleDraftUpdate = (_index: number, updates: Partial<InserterFormData>) => {
        setDraft(d => ({ ...d, ...updates }));
    };

    // one update with what changed; the overrides only when the rule did, so an untouched rule (a forced ALWAYS
    // included) stays as it is
    const handleSave = () => {
        const updates: Partial<InserterFormData> = { ...changedFields };
        if (rule.changed) {
            updates.overrides = { ...inserter.overrides, enable_control: rule.override };
        }
        onUpdate(entityIndex, updates);
        onClose();
    };

    return (
        <Box>
            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
            >
                {/* a tab with unsaved edits is marked "•" (its chip still shows the saved rule) */}
                <Tab
                    label={<TabLabel text="Config" unsaved={configDirty} />}
                    id={`${id}-tab-0`}
                    aria-controls={`${id}-tabpanel-0`}
                />
                <Tab
                    label={<TabLabel text="Enable rule" unsaved={rule.changed} />}
                    id={`${id}-tab-1`}
                    aria-controls={`${id}-tabpanel-1`}
                    iconPosition="end"
                    icon={
                        savedRule.quiet
                            ? undefined
                            : <Chip label={savedRule.chip} title={savedRule.summary} size="small" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />
                    }
                />
            </Tabs>

            {/* both tabs stay mounted, so a draft on one survives a visit to the other */}
            <Box role="tabpanel" id={`${id}-tabpanel-0`} aria-labelledby={`${id}-tab-0`} hidden={activeTab !== 0} sx={{ p: 2 }}>
                <InserterEditSection
                    inserter={draft}
                    entityIndex={entityIndex}
                    machines={machines}
                    belts={belts}
                    chests={chests}
                    itemNames={itemNames}
                    getRecipeInfo={getRecipeInfo}
                    onUpdate={handleDraftUpdate}
                />
            </Box>
            <Box role="tabpanel" id={`${id}-tabpanel-1`} aria-labelledby={`${id}-tab-1`} hidden={activeTab !== 1} sx={{ p: 2 }}>
                <EnableControlFormContent
                    entityType="inserter"
                    currentOverride={currentOverride}
                    onDraftChange={setRule}
                    hideActions
                    sourceType={draft.source.type}
                    sinkType={draft.sink.type}
                    availableItems={availableItems}
                    copyFromOptions={copyFromOptions}
                />
            </Box>

            <Box
                sx={{
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 1,
                    px: 2,
                    py: 1.5,
                    borderTop: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                }}
            >
                {dirty && (
                    <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                        Unsaved changes
                    </Typography>
                )}
                <Button onClick={onClose} color="inherit">Cancel</Button>
                <Button onClick={handleSave} variant="contained" color="secondary" disabled={!dirty}>
                    Save
                </Button>
            </Box>
        </Box>
    );
}
