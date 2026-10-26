import { Box, Button, Typography } from '@mui/material';
import { ArrowForward } from '@mui/icons-material';
import { useCraftingMachines } from '../hooks/useCraftingMachines';
import { memo, useMemo, useRef, type ReactNode } from 'react';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { useAnnounce } from '../hooks/useMessages';
import { entityOptionsOf, findOption, type EntityOption } from '../utils/inserterOptions';
import { inferInserterItems, sourceItemsOf } from '../utils/inferInserterItems';
import { BLACKLIST_NOTE, filtersLabel, removeFilterSlot, setFilterSlot, usesAutomaticFilters, usesBlacklist } from '../utils/inserterFilters';
import { DROP_ROUTE_READ_ONLY, endpointUpdate, INSERTER_TIMING_ASSUMPTION, inserterTimingLabels } from '../utils/inserterMetadata';
import { FilterSlotSelector } from './FilterSlotSelector';
import { NearLaneSelect } from './NearLaneSelect';
import { PickupTypeSelect } from './PickupTypeSelect';
import { InserterStackSizeControl } from './InserterStackSizeControl';
import { EntitySelector } from './EntitySelector';
import { isContainerChest } from '../utils/configForm/formData';
import { entityLabel } from '../utils/entityLabel';

const PICKER_GROUP_SX = { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0, alignSelf: 'start' };

export interface InserterEditorProps {
    value: InserterFormData;
    label: string;
    layout: 'row' | 'stacked' | 'workbench';
    /** Inserter identity and reorder controls in the unified List workbench. */
    identity?: ReactNode;
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    /** The drills: a container holds what the ones that drop into it mine */
    drills?: readonly DrillFormData[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    onChange: (updates: Partial<InserterFormData>) => void;
    /** Caller-owned rule controls, rendered alongside the row's capacity and filters. */
    rowActions?: ReactNode;
    /** Header actions follow the route fields in keyboard order, before expanded settings. */
    routeActions?: ReactNode;
    /** Compact route status shares the space below the source field. */
    routeSummary?: ReactNode;
    rowSettings?: (fields: ReactNode) => ReactNode;
    /** A List card shares its memoized options across its rows. */
    options?: EntityOption[];
}

const NO_DRILLS: readonly DrillFormData[] = [];

/** Stateless shared fields: the row commits changes live; the dialog passes a draft setter. */
export const InserterEditor = memo(function InserterEditor({ value, label, layout, machines, inserters, belts, chests, drills = NO_DRILLS, itemNames, getRecipeInfo, onChange, rowActions, routeActions, routeSummary, rowSettings, options, identity }: InserterEditorProps) {
    const row = layout !== 'stacked';
    const workbench = layout === 'workbench';
    const timing = inserterTimingLabels(value);
    const { itemLabel, recipeLabel } = useGameNames();
    const announce = useAnnounce();
    const filtersRef = useRef<HTMLDivElement>(null);
    const ownOptions = useMemo(() => options ?? entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }, { inserters, getRecipeInfo, drills }), [options, machines, belts, chests, itemLabel, recipeLabel, inserters, getRecipeInfo, drills]);
    const craftingMachines = useCraftingMachines();
    const inferred = useMemo(() => inferInserterItems(value, machines, belts, chests, getRecipeInfo, inserters, craftingMachines, drills), [value, machines, belts, chests, getRecipeInfo, inserters, craftingMachines, drills]);
    const priority = useMemo(() => ({ label: `From ${findOption(ownOptions, value.source.type, value.source.id)?.label ?? 'source'}`, ids: sourceItemsOf(value.source, machines, belts, chests, getRecipeInfo, inserters, drills) }), [ownOptions, value.source, machines, belts, chests, getRecipeInfo, inserters, drills]);
    const filterChange = (result: ReturnType<typeof setFilterSlot>) => {
        onChange({ filters: result.filters });
        if (result.becameExplicit) announce(`${label}'s filters are now set by hand.`);
    };
    const routeOption = (side: 'source' | 'sink') => {
        const option = findOption(ownOptions, value[side].type, value[side].id);
        const chest = option?.type === 'chest' ? chests.find(chest => chest.id === option.id) : undefined;
        if (!option || !chest || !isContainerChest(chest) || usesBlacklist(value)) return option;
        // Show this route's items in the field: a silo's incoming ingredients can differ from its outgoing cargo.
        const items = usesAutomaticFilters(value.filters) ? inferred : value.filters?.filter(Boolean) ?? [];
        return { ...option, ingredientIcons: items.length ? items : undefined,
            sublabel: items.length ? items.map(itemLabel).join(', ') : 'No items inferred' };
    };
    const picker = (side: 'source' | 'sink', name: string) => (
        <EntitySelector label={name} ariaLabel={`${name}, ${label}`} options={ownOptions}
            showContentIcons={!workbench}
            sx={row ? { flex: '1 1 160px', minWidth: 0 } : { width: '100%' }}
            readOnly={value.sink.drop !== undefined} value={routeOption(side)}
            error={!findOption(ownOptions, value[side].type, value[side].id)}
            helperText={value.sink.drop && side === 'sink' ? `Drop: lane ${value.sink.drop.lane}, position ${value.sink.drop.position}. ${DROP_ROUTE_READ_ONLY}`
                : !findOption(ownOptions, value[side].type, value[side].id) ? `${entityLabel(value[side].type, value[side].id)} is unavailable.` : undefined}
            onChange={option => onChange(endpointUpdate(value, side, { type: option.type, id: option.id }))}
            rowFirst={side === 'source'} />
    );
    const filterFields = (
            <Box ref={filtersRef} sx={row ? { alignSelf: 'start', minWidth: 0, flex: '1 1 180px' } : { mt: 2 }}>
                <FilterSlotSelector compact={row} label={row ? `Filters · ${filtersLabel(value, 'Automatic', 'Explicit')}` : 'Filters'} filters={value.filters} inferredFilters={inferred} itemNames={itemNames} priority={priority}
                    onFilterChange={(slot, item) => filterChange(setFilterSlot(value.filters, inferred.slice(0, 5), slot, item))}
                    onRemoveFilter={slot => filterChange(removeFilterSlot(value.filters, inferred.slice(0, 5), slot))} />
                {!row && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{usesAutomaticFilters(value.filters) ? inferred.length ? 'Automatic filters · From source and destination' : 'Automatic · No items inferred' : usesBlacklist(value) ? BLACKLIST_NOTE : 'Explicit · Set by hand'}</Typography>}
                {row && usesBlacklist(value) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{BLACKLIST_NOTE}</Typography>}
                {!usesAutomaticFilters(value.filters) && <Box sx={{ mt: row ? 0 : 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                    <Button size="small" color="inherit" onClick={() => {
                        // The return action disappears; slot zero survives the switch back to Automatic.
                        filtersRef.current?.querySelector<HTMLElement>('button[aria-haspopup="dialog"]')?.focus();
                        onChange({ filters: undefined });
                        announce(`${label}'s filters follow its source and destination again.`);
                    }}>Use automatic filters</Button>
                </Box>}
            </Box>
    );
    const advancedFields = (
        <Box sx={row ? { display: 'flex', gridColumn: '1 / -1', flexWrap: 'wrap', alignItems: 'start', gap: 1.5, minWidth: 0 } : { display: 'contents' }}>
            {workbench && <PickupTypeSelect source={value.source} entityLabel={label} onChange={source => onChange({ source })} />}
            {row && <NearLaneSelect compact source={value.source} belts={belts} entityLabel={label} onChange={source => onChange({ source })} />}
            <InserterStackSizeControl id={`${row ? '' : 'diagram-'}inserter-stack-size-${value.id}`}
                value={value} label={label} compact={row} onChange={stackSize => onChange({ stack_size: stackSize })} />
            {!workbench && filterFields}
            {row && rowActions}
        </Box>
    );
    if (workbench) return <>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) 24px auto 24px minmax(0, 1fr) auto', gap: 1, alignItems: 'start', minWidth: 0,
            '@container inserter-row (max-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr) auto',
                '& > [data-workbench-identity]': { gridColumn: 1, gridRow: 1 },
                '& > [data-workbench-source]': { gridColumn: '1 / -1', gridRow: 2 },
                '& > [data-workbench-filters]': { gridColumn: '1 / -1', gridRow: 3, width: 'auto', maxWidth: '100%' },
                '& > [data-workbench-sink]': { gridColumn: '1 / -1', gridRow: 4 },
                '& > [data-workbench-actions]': { gridColumn: 2, gridRow: 1 },
                '& > [data-workbench-arrow]': { display: 'none' } } }}>
            <Box data-workbench-identity="" sx={{ display: 'flex', alignItems: 'center', minHeight: 40 }}>{identity}</Box>
            <Box data-workbench-source="" sx={{ minWidth: 0, pt: 1 }}>{picker('source', 'Source')}
                {routeSummary && <Box sx={{ mt: 0.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>{routeSummary}</Box>}
            </Box>
            <ArrowForward data-workbench-arrow="" aria-hidden sx={{ mt: 2, fontSize: 24, color: 'text.primary' }} />
            <Box data-workbench-filters="" sx={{ minWidth: 0, width: 'max-content', maxWidth: 240, pt: 0.625 }}>{filterFields}</Box>
            <ArrowForward data-workbench-arrow="" aria-hidden sx={{ mt: 2, fontSize: 24, color: 'text.primary' }} />
            <Box data-workbench-sink="" sx={{ minWidth: 0, pt: 1 }}>{picker('sink', 'Destination')}</Box>
            <Box data-workbench-actions="" sx={{ display: 'flex', alignItems: 'center', pt: 1 }}>{routeActions}</Box>
        </Box>
        {rowSettings ? rowSettings(advancedFields) : advancedFields}
    </>;
    const fields = <>
        {!row && <>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>Type: {value.prototype === undefined ? 'Automatic' : 'Explicit'} {timing.type} · Quality: {value.quality === undefined ? 'Automatic' : 'Explicit'} {timing.quality}</Typography>
            {(!value.prototype || !value.quality) && <Typography variant="body2" color="text.secondary">{INSERTER_TIMING_ASSUMPTION}</Typography>}
        </>}
        <Box sx={row ? { ...PICKER_GROUP_SX, flexWrap: 'wrap' } : { display: 'contents' }}>
            {picker('source', 'Source')}
            <PickupTypeSelect compact={row} source={value.source} entityLabel={label} onChange={source => onChange({ source })} />
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
