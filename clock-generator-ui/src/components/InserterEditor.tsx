import { Box, Button, Typography } from '@mui/material';
import { memo, useMemo, useRef, type ReactNode } from 'react';
import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { useAnnounce } from '../hooks/useMessages';
import { entityOptionsOf, findOption, stackSizeFrom, type EntityOption } from '../utils/inserterOptions';
import { inferInserterItems, sourceItemsOf } from '../utils/inferInserterItems';
import { BLACKLIST_NOTE, filtersLabel, removeFilterSlot, setFilterSlot, usesAutomaticFilters, usesBlacklist } from '../utils/inserterFilters';
import { DROP_ROUTE_READ_ONLY, endpointUpdate, effectiveInserterStackSize, INSERTER_TIMING_ASSUMPTION, inserterTimingLabels, inserterStackSizeHelp } from '../utils/inserterMetadata';
import { FilterSlotSelector } from './FilterSlotSelector';
import { NearLaneSelect } from './NearLaneSelect';
import { PickupTypeSelect } from './PickupTypeSelect';
import { NumberField } from './NumberField';
import { EntitySelector } from './EntitySelector';

const PICKER_GROUP_SX = { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0, alignSelf: 'start' };

export interface InserterEditorProps {
    value: InserterFormData;
    label: string;
    layout: 'row' | 'stacked';
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

/** Stateless shared fields: the row commits changes live; the dialog passes a draft setter. */
export const InserterEditor = memo(function InserterEditor({ value, label, layout, machines, belts, chests, itemNames, getRecipeInfo, onChange, rowActions, routeActions, rowSettings, options }: InserterEditorProps) {
    const row = layout === 'row';
    const capacity = effectiveInserterStackSize(value);
    const timing = inserterTimingLabels(value);
    const stackHelp = value.stack_size !== undefined ? `Explicit: ${value.stack_size} items.`
        : row && Number.isFinite(capacity) ? `Automatic: ${capacity} items.` : inserterStackSizeHelp(value);
    const { itemLabel, recipeLabel } = useGameNames();
    const announce = useAnnounce();
    const filtersRef = useRef<HTMLDivElement>(null);
    const ownOptions = useMemo(() => options ?? entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }), [options, machines, belts, chests, itemLabel, recipeLabel]);
    const inferred = useMemo(() => inferInserterItems(value, machines, belts, chests, getRecipeInfo), [value, machines, belts, chests, getRecipeInfo]);
    const priority = useMemo(() => ({ label: `From ${findOption(ownOptions, value.source.type, value.source.id)?.label ?? 'source'}`, ids: sourceItemsOf(value.source, machines, belts, chests, getRecipeInfo) }), [ownOptions, value.source, machines, belts, chests, getRecipeInfo]);
    const filterChange = (result: ReturnType<typeof setFilterSlot>) => {
        onChange({ filters: result.filters });
        if (result.becameExplicit) announce(`${label}'s filters are now set by hand.`);
    };
    const picker = (side: 'source' | 'sink', name: string) => (
        <EntitySelector label={name} ariaLabel={`${name}, ${label}`} options={ownOptions}
            sx={row ? { flex: '1 1 160px', minWidth: 0 } : { width: '100%' }}
            readOnly={value.sink.drop !== undefined} value={findOption(ownOptions, value[side].type, value[side].id)}
            error={!findOption(ownOptions, value[side].type, value[side].id)}
            helperText={value.sink.drop && side === 'sink' ? `Drop: lane ${value.sink.drop.lane}, position ${value.sink.drop.position}. ${DROP_ROUTE_READ_ONLY}` : undefined}
            onChange={option => onChange(endpointUpdate(value, side, { type: option.type, id: option.id }))}
            rowFirst={side === 'source'} />
    );
    const advancedFields = (
        <Box sx={row ? { display: 'flex', gridColumn: '1 / -1', flexWrap: 'wrap', alignItems: 'start', gap: 1.5, minWidth: 0 } : { display: 'contents' }}>
            {row && <NearLaneSelect compact source={value.source} belts={belts} entityLabel={label} onChange={source => onChange({ source })} />}
            <NumberField id={`${row ? '' : 'diagram-'}inserter-stack-size-${value.id}`} label="Stack size" value={value.stack_size ?? null}
                placeholder="Automatic" helperText={stackHelp} onValueChange={n => onChange({ stack_size: stackSizeFrom(n) })}
                min={1} step={1} sx={{ width: row ? 130 : '100%', maxWidth: '100%', alignSelf: 'start' }} size="small" />
            <Box ref={filtersRef} sx={row ? { alignSelf: 'start', minWidth: 0, flex: '1 1 180px' } : { mt: 2 }}>
                <FilterSlotSelector compact={row} label={row ? `Filters · ${filtersLabel(value, 'Automatic', 'Explicit')}` : 'Filters'} filters={value.filters} inferredFilters={inferred} itemNames={itemNames} priority={priority}
                    onFilterChange={(slot, item) => filterChange(setFilterSlot(value.filters, inferred.slice(0, 5), slot, item))}
                    onRemoveFilter={slot => filterChange(removeFilterSlot(value.filters, inferred.slice(0, 5), slot))} />
                {!row && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{usesAutomaticFilters(value.filters) ? 'Automatic filters' : usesBlacklist(value) ? BLACKLIST_NOTE : 'Explicit · Set by hand'}</Typography>}
                {row && usesBlacklist(value) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{BLACKLIST_NOTE}</Typography>}
                {!usesAutomaticFilters(value.filters) && inferred.length > 0 && <Box sx={{ mt: row ? 0 : 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
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
