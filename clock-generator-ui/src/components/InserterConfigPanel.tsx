import {
    Autocomplete,
    Box,
    Chip,
    Tab,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import { EnableControlMode, TargetType } from 'clock-generator/browser';
import { useMemo, useState } from 'react';
import type {
    BeltFormData,
    ChestFormData,
    InserterFormData,
    MachineFormData,
} from '../hooks/useConfigForm';
import { isBufferChest, isInfinityChest } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { inferInserterItems } from '../utils/inferInserterItems';
import type { EnableControlFormContentProps } from './EnableControlModal';
import { EnableControlFormContent, type CopyFromOption } from './EnableControlModal';
import { FactorioIcon } from './FactorioIcon';
import { FilterSlotSelector } from './FilterSlotSelector';
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
    const entityOptions = useMemo<EntityOption[]>(() => {
        const options: EntityOption[] = [];
        machines.forEach(m => options.push({
            type: TargetType.MACHINE, id: m.id,
            label: `Machine ${m.id}`,
            icon: m.recipe || 'assembling-machine-3',
            sublabel: m.recipe || 'No recipe',
        }));
        belts.forEach(b => {
            const ingredientIcons = b.lanes.map(l => l.ingredient).filter(Boolean);
            options.push({
                type: TargetType.BELT, id: b.id,
                label: `Belt ${b.id}`, icon: b.type,
                ingredientIcons: ingredientIcons.length > 0 ? ingredientIcons : undefined,
            });
        });
        chests.forEach(c => options.push({
            type: TargetType.CHEST, id: c.id,
            label: `Chest ${c.id}`,
            icon: isInfinityChest(c) ? 'infinity-chest' : 'iron-chest',
            sublabel: isBufferChest(c) ? (c.item_filter || 'No filter') : undefined,
        }));
        return options;
    }, [machines, belts, chests]);

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
                <FactorioIcon name={opt.icon} size={20} />
                {opt.ingredientIcons?.map((ing, i) => <FactorioIcon key={i} name={ing} size={16} />)}
            </Box>
        ) : null;

    const renderOption = (props: React.HTMLAttributes<HTMLLIElement> & { key?: string }, option: EntityOption) => {
        const { key, ...rest } = props;
        return (
            <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FactorioIcon name={option.icon} size={24} />
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

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                <FactorioIcon name="stack-inserter" size={22} />
                <Typography variant="body2" color="text.secondary">
                    Inserter #{inserter.id} — Tile 2
                </Typography>
                <Box sx={{ flex: 1 }} />
                <NumberField
                    label="Stack Size"
                    value={inserter.stack_size}
                    onValueChange={(val) => onUpdate(entityIndex, { stack_size: val ?? 1 })}
                    min={1}
                    sx={{ width: 130 }}
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

export interface InserterConfigPanelProps {
    inserter: InserterFormData;
    entityIndex: number;
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    onUpdate: (index: number, updates: Partial<InserterFormData>) => void;
}

// ---- Exported panel ----

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
}: InserterConfigPanelProps) {
    const [activeTab, setActiveTab] = useState(0);
    const [overrideFormKey, setOverrideFormKey] = useState(0);

    const currentOverride = inserter.overrides?.enable_control;
    const overrideMode = currentOverride?.mode ?? EnableControlMode.AUTO;
    const hasNonDefaultOverride = overrideMode !== EnableControlMode.AUTO;

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
        addFromEntity(inserter.source.type, inserter.source.id);
        addFromEntity(inserter.sink.type, inserter.sink.id);
        return [...items];
    }, [inserter, machines, belts, chests, getRecipeInfo]);

    const copyFromOptions = useMemo<CopyFromOption[]>(() => {
        return inserters
            .filter(ins =>
                ins.id !== inserter.id &&
                ins.overrides?.enable_control?.mode &&
                ins.overrides.enable_control.mode !== EnableControlMode.AUTO,
            )
            .map(ins => ({
                label: `Inserter ${ins.id}`,
                override: ins.overrides!.enable_control!,
            }));
    }, [inserter.id, inserters]);

    const handleSaveOverride: EnableControlFormContentProps['onSave'] = (override) => {
        onUpdate(entityIndex, {
            overrides: { ...inserter.overrides, enable_control: override },
        });
        setOverrideFormKey(k => k + 1);
    };

    const handleCancelOverride = () => {
        setOverrideFormKey(k => k + 1);
    };

    return (
        <Box>
            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
            >
                <Tab label="Config" />
                <Tab
                    label="Overrides"
                    iconPosition="end"
                    icon={
                        hasNonDefaultOverride
                            ? <Chip label={overrideMode} size="small" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />
                            : undefined
                    }
                />
            </Tabs>

            <Box sx={{ p: 2 }}>
                {activeTab === 0 && (
                    <InserterEditSection
                        inserter={inserter}
                        entityIndex={entityIndex}
                        machines={machines}
                        belts={belts}
                        chests={chests}
                        itemNames={itemNames}
                        getRecipeInfo={getRecipeInfo}
                        onUpdate={onUpdate}
                    />
                )}
                {activeTab === 1 && (
                    <EnableControlFormContent
                        key={overrideFormKey}
                        entityType="inserter"
                        currentOverride={currentOverride}
                        onSave={handleSaveOverride}
                        onCancel={handleCancelOverride}
                        sourceType={inserter.source.type}
                        sinkType={inserter.sink.type}
                        availableItems={availableItems}
                        copyFromOptions={copyFromOptions}
                    />
                )}
            </Box>
        </Box>
    );
}
