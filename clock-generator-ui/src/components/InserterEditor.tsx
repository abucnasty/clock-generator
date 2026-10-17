import { Autocomplete, Box, Button, createFilterOptions, TextField, Typography, type AutocompleteRenderInputParams } from '@mui/material';
import { Check } from '@mui/icons-material';
import { memo, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { DisplayDensity } from '../utils/displayPreferences';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { useAnnounce } from '../hooks/useMessages';
import { entityOptionsOf, findOption, stackSizeFrom, type EntityOption } from '../utils/inserterOptions';
import { inferInserterItems, sourceItemsOf } from '../utils/inferInserterItems';
import { removeFilterSlot, setFilterSlot, usesAutomaticFilters } from '../utils/inserterFilters';
import { DROP_ROUTE_READ_ONLY, endpointUpdate, effectiveInserterStackSize, INSERTER_TIMING_ASSUMPTION, inserterTimingLabels, inserterStackSizeHelp } from '../utils/inserterMetadata';
import { FactorioIcon } from './FactorioIcon';
import { FilterSlotSelector } from './FilterSlotSelector';
import { NearLaneSelect } from './NearLaneSelect';
import { NumberField } from './NumberField';
import { EntityBadge } from './EntityBadge';
import { BeltLanePreview } from './BeltLanePreview';

const PICKER_GROUP_SX = { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0, alignSelf: 'start' };
const ROW_REST_SX = {
    display: 'flex', gridColumn: '1 / -1',
    flexWrap: 'wrap', alignItems: 'start', gap: 2, minWidth: 0,
};

export interface InserterEditorProps {
    value: InserterFormData;
    label: string;
    layout: 'row' | 'stacked';
    /** Presentation only: form ownership and controlled values stay with the caller. */
    density?: DisplayDensity;
    machines: MachineFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    onChange: (updates: Partial<InserterFormData>) => void;
    /** Caller-owned rule controls, rendered alongside the row's capacity and filters. */
    rowActions?: ReactNode;
    /** Header actions follow the route fields in keyboard order, before expanded settings. */
    routeActions?: ReactNode;
    rowSettings?: (fields: ReactNode) => ReactNode;
    /** A List card shares its memoized options across its rows. */
    options?: EntityOption[];
}

const ENTITY_GROUPS = { machine: 'Machines', belt: 'Belts', chest: 'Chests' };

function routeLabel(option: EntityOption | undefined): string {
    return option ? option.sublabel ? `${option.label} - ${option.sublabel}` : option.label : '';
}

function RouteBadge({ option }: { option: EntityOption }) {
    return <Box component="span" aria-hidden sx={{ display: 'inline-flex', flexShrink: 0 }}>
        <EntityBadge id={option.id} size="small">
            {option.belt
                ? <Box component="span" sx={{ width: 31, height: 28, position: 'relative', '& > span': { position: 'absolute', left: 0, top: 0, transform: 'scale(0.7)', transformOrigin: 'top left' } }}><BeltLanePreview belt={option.belt} /></Box>
                : <FactorioIcon name={option.icon} size={22} alt="" />}
        </EntityBadge>
    </Box>;
}

function ContentIcons({ option, size = 18 }: { option: EntityOption; size?: number }) {
    const icons = option.ingredientIcons ?? [];
    if (!icons.length) return null;
    return <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
        {icons.slice(0, 2).map((item, i) => <FactorioIcon key={`${item}-${i}`} name={item} size={size} alt="" />)}
        {icons.length > 2 && <Typography component="span" variant="caption">+{icons.length - 2}</Typography>}
    </Box>;
}

function renderOption(props: HTMLAttributes<HTMLLIElement> & { key?: string }, option: EntityOption, { selected }: { selected: boolean }, itemLabel: (id: string) => string) {
    const { key, ...rest } = props;
    return (
        <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <RouteBadge option={option} />
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography variant="body2">{option.label}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ContentIcons option={option} size={16} />
                    <Typography variant="caption" color="text.secondary">{option.sublabel ?? (option.ingredientIcons?.length ? option.ingredientIcons.map(itemLabel).join(' · ') : 'No items')}</Typography>
                </Box>
            </Box>
            {selected && <Check aria-hidden sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
        </Box>
    );
}

/** Stateless shared fields: the row commits changes live; the dialog passes a draft setter. */
export const InserterEditor = memo(function InserterEditor({ value, label, layout, density = 'explanatory', machines, belts, chests, itemNames, getRecipeInfo, onChange, rowActions, routeActions, rowSettings, options }: InserterEditorProps) {
    const row = layout === 'row';
    const compact = row && density === 'compact';
    const capacity = effectiveInserterStackSize(value);
    const timing = inserterTimingLabels(value);
    const stackHelp = value.stack_size !== undefined ? `Explicit: ${value.stack_size} items.`
        : compact && Number.isFinite(capacity) ? `Automatic: ${capacity} items.` : inserterStackSizeHelp(value);
    const { itemLabel, recipeLabel } = useGameNames();
    const announce = useAnnounce();
    const filtersRef = useRef<HTMLDivElement>(null);
    const [routeSearch, setRouteSearch] = useState<Partial<Record<'source' | 'sink', string>>>({});
    const ownOptions = useMemo(() => options ?? entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }), [options, machines, belts, chests, itemLabel, recipeLabel]);
    const filterOptions = useMemo(() => createFilterOptions<EntityOption>({
        stringify: option => [option.label, option.sublabel, option.icon, ...(option.ingredientIcons ?? []), ...(option.ingredientIcons ?? []).map(itemLabel)].filter(Boolean).join(' '),
    }), [itemLabel]);
    const inferred = useMemo(() => inferInserterItems(value, machines, belts, chests, getRecipeInfo), [value, machines, belts, chests, getRecipeInfo]);
    const priority = useMemo(() => ({ label: `From ${findOption(ownOptions, value.source.type, value.source.id)?.label ?? 'source'}`, ids: sourceItemsOf(value.source, machines, belts, chests, getRecipeInfo) }), [ownOptions, value.source, machines, belts, chests, getRecipeInfo]);
    const filterChange = (result: ReturnType<typeof setFilterSlot>) => {
        onChange({ filters: result.filters });
        if (result.becameExplicit) announce(`${label}'s filters are now set by hand.`);
    };
    const input = (params: AutocompleteRenderInputParams, name: string, selected: EntityOption | undefined) => (
        <TextField {...params} label={name} error={!selected} title={selected ? [selected.label, selected.sublabel, selected.belt?.lanes.map((lane, i) => `Lane ${i + 1}: ${lane.ingredient ? itemLabel(lane.ingredient) : 'empty'}`).join(' · ')].filter(Boolean).join(' — ') : undefined} helperText={value.sink.drop && name === 'Destination'
            ? `Drop: lane ${value.sink.drop.lane}, position ${value.sink.drop.position}. ${DROP_ROUTE_READ_ONLY}` : undefined} slotProps={{ htmlInput: { ...params.inputProps, 'aria-label': `${name}, ${label}` }, input: {
            ...params.InputProps,
            startAdornment: selected ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                <RouteBadge option={selected} />
                <ContentIcons option={selected} />
            </Box> : null,
        } }} />
    );
    const picker = (side: 'source' | 'sink', name: string) => (
        <Autocomplete size="small" sx={row ? { flex: '1 1 160px', minWidth: 0 } : { width: '100%' }} options={ownOptions}
            readOnly={value.sink.drop !== undefined}
            value={findOption(ownOptions, value[side].type, value[side].id)}
            inputValue={routeSearch[side] ?? routeLabel(findOption(ownOptions, value[side].type, value[side].id))}
            onInputChange={(_, text, reason) => setRouteSearch(previous => ({ ...previous, [side]: reason === 'input' ? text : undefined }))}
            onClose={() => setRouteSearch(previous => ({ ...previous, [side]: undefined }))}
            onChange={(_, option) => { if (option) onChange(endpointUpdate(value, side, { type: option.type, id: option.id })); }}
            getOptionLabel={routeLabel}
            groupBy={option => ENTITY_GROUPS[option.type]}
            getOptionKey={option => `${option.type}-${option.id}`}
            filterOptions={filterOptions}
            isOptionEqualToValue={(a, b) => a.type === b.type && a.id === b.id}
            renderInput={params => input(params, name, findOption(ownOptions, value[side].type, value[side].id))}
            slotProps={{ popper: { role: 'region', 'aria-label': `${name} options` } }}
            renderOption={(props, option, state) => renderOption(props, option, state, itemLabel)} autoHighlight disableClearable
            data-row-first={side === 'source' ? '' : undefined}
        />
    );
    const advancedFields = (
        <Box sx={row ? compact ? { display: 'flex', gridColumn: '1 / -1', flexWrap: 'wrap', alignItems: 'start', gap: 1.5, minWidth: 0 } : ROW_REST_SX : { display: 'contents' }}>
            {row && <NearLaneSelect compact source={value.source} belts={belts} entityLabel={label} onChange={source => onChange({ source })} />}
            <NumberField id={`${row ? '' : 'diagram-'}inserter-stack-size-${value.id}`} label="Stack size" value={value.stack_size ?? null}
                placeholder="Automatic" helperText={stackHelp} onValueChange={n => onChange({ stack_size: stackSizeFrom(n) })}
                min={1} step={1} sx={{ width: row ? 130 : '100%', maxWidth: '100%', alignSelf: 'start' }} size="small" />
            <Box ref={filtersRef} sx={row ? { alignSelf: 'start', pt: compact ? 0 : '4px', minWidth: 0, flex: '1 1 180px' } : { mt: 2 }}>
                <FilterSlotSelector compact={compact} label={compact ? `Filters · ${usesAutomaticFilters(value.filters) ? 'Automatic' : 'Explicit'}` : 'Filters'} filters={value.filters} inferredFilters={inferred} itemNames={itemNames} priority={priority}
                    onFilterChange={(slot, item) => filterChange(setFilterSlot(value.filters, inferred.slice(0, 5), slot, item))}
                    onRemoveFilter={slot => filterChange(removeFilterSlot(value.filters, inferred.slice(0, 5), slot))} />
                <Typography variant="caption" color="text.secondary" sx={{ display: compact ? 'none' : 'block', mt: 1 }}>{usesAutomaticFilters(value.filters) ? 'Automatic filters' : 'Explicit · Set by hand'}</Typography>
                {!usesAutomaticFilters(value.filters) && inferred.length > 0 && <Box sx={{ mt: compact ? 0 : 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                    <Button size="small" color="inherit" onClick={() => {
                        // The return action disappears; slot zero survives the switch back to Automatic.
                        filtersRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus();
                        onChange({ filters: undefined });
                        announce(`${label}'s filters follow its source and destination again.`);
                    }}>Use automatic filters</Button>
                </Box>}
            </Box>
            {row && rowActions}
        </Box>
    );
    const fields = <>
        {!row && <>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>Type: {value.prototype === undefined ? 'Automatic' : 'Explicit'} {timing.type} · Quality: {value.quality === undefined ? 'Automatic' : 'Explicit'} {timing.quality}</Typography>
            {(!value.prototype || !value.quality) && <Typography variant="body2" color="text.secondary">{INSERTER_TIMING_ASSUMPTION}</Typography>}
        </>}
        <Box sx={row ? { ...PICKER_GROUP_SX, flexWrap: 'wrap' } : { display: 'contents' }}>
            {picker('source', 'Source')}
            {!row && <NearLaneSelect compact={row} source={value.source} belts={belts} entityLabel={label} onChange={source => onChange({ source })} />}
        </Box>
        <Box sx={row ? PICKER_GROUP_SX : { display: 'contents' }}>
            {row && <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>→</Typography>}
            {picker('sink', 'Destination')}
        </Box>
        {row && routeActions}
        {row && rowSettings ? rowSettings(advancedFields) : advancedFields}
    </>;
    return row ? fields : <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{fields}</Box>;
});
