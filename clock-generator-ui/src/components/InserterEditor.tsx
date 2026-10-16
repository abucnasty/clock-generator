import { Autocomplete, Box, Button, TextField, Typography, type AutocompleteRenderInputParams } from '@mui/material';
import { memo, useMemo, type HTMLAttributes, type ReactNode } from 'react';
import type { BeltFormData, ChestFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { useAnnounce } from '../hooks/useMessages';
import { entityOptionsOf, findOption, stackSizeFrom, type EntityOption } from '../utils/inserterOptions';
import { inferInserterItems, sourceItemsOf } from '../utils/inferInserterItems';
import { removeFilterSlot, setFilterSlot, usesAutomaticFilters } from '../utils/inserterFilters';
import { INSERTER_TIMING_ASSUMPTION, inserterMetadataText, inserterStackSizeHelp } from '../utils/inserterMetadata';
import { FactorioIcon } from './FactorioIcon';
import { FilterSlotSelector } from './FilterSlotSelector';
import { NearLaneSelect } from './NearLaneSelect';
import { NumberField } from './NumberField';

const ONE_LINE = '@media (min-width: 1600px)';
const PICKER_GROUP_SX = { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0, alignSelf: 'start', [ONE_LINE]: { alignSelf: 'center' } };
const ROW_REST_SX = {
    display: { xs: 'flex', sm: 'grid' }, gridColumn: '1 / -1',
    gridTemplateColumns: { sm: '130px minmax(0, 1fr) 8.5rem 40px' },
    flexWrap: 'wrap', alignItems: 'start', gap: 2,
    [ONE_LINE]: { display: 'contents', gridColumn: 'auto' },
};

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
    /** Caller-owned rule/menu/delete cells, rendered directly in the row's trailing grid. */
    rowActions?: ReactNode;
    /** A List card shares its memoized options across its rows. */
    options?: EntityOption[];
}

function renderOption(props: HTMLAttributes<HTMLLIElement> & { key?: string }, option: EntityOption) {
    const { key, ...rest } = props;
    return (
        <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FactorioIcon name={option.icon} size={24} alt="" />
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2">{option.label}</Typography>
                {option.sublabel ? <Typography variant="caption" color="text.secondary">{option.sublabel}</Typography> : option.ingredientIcons?.length ? (
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        {option.ingredientIcons.map((item, i) => <FactorioIcon key={i} name={item} size={16} alt="" />)}
                    </Box>
                ) : <Typography variant="caption" color="text.secondary">No items</Typography>}
            </Box>
        </Box>
    );
}

/** Stateless shared fields: the row commits changes live; the dialog passes a draft setter. */
export const InserterEditor = memo(function InserterEditor({ value, label, layout, machines, belts, chests, itemNames, getRecipeInfo, onChange, rowActions, options }: InserterEditorProps) {
    const row = layout === 'row';
    const { itemLabel, recipeLabel } = useGameNames();
    const announce = useAnnounce();
    const ownOptions = useMemo(() => options ?? entityOptionsOf(machines, belts, chests, { item: itemLabel, recipe: recipeLabel }), [options, machines, belts, chests, itemLabel, recipeLabel]);
    const inferred = useMemo(() => inferInserterItems(value, machines, belts, chests, getRecipeInfo), [value, machines, belts, chests, getRecipeInfo]);
    const priority = useMemo(() => ({ label: `From ${findOption(ownOptions, value.source.type, value.source.id)?.label ?? 'source'}`, ids: sourceItemsOf(value.source, machines, belts, chests, getRecipeInfo) }), [ownOptions, value.source, machines, belts, chests, getRecipeInfo]);
    const filterChange = (result: ReturnType<typeof setFilterSlot>) => {
        onChange({ filters: result.filters });
        if (result.becameExplicit) announce(`${label}'s filters are now set by hand.`);
    };
    const input = (params: AutocompleteRenderInputParams, name: string, selected: EntityOption | undefined) => (
        <TextField {...params} label={name} error={!selected} slotProps={{ input: {
            ...params.InputProps,
            startAdornment: selected ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                <FactorioIcon name={selected.icon} size={20} alt="" />
                {selected.ingredientIcons?.length ? <>
                    <Typography variant="body2" sx={{ mx: 0.5 }}>:</Typography>
                    {selected.ingredientIcons.map((item, i) => <FactorioIcon key={i} name={item} size={18} alt="" />)}
                </> : null}
            </Box> : null,
        } }} />
    );
    const picker = (side: 'source' | 'sink', name: string) => (
        <Autocomplete size="small" sx={row ? { flex: '1 1 160px', minWidth: 0 } : { width: '100%' }} options={ownOptions}
            value={findOption(ownOptions, value[side].type, value[side].id)}
            onChange={(_, option) => { if (option) onChange({ [side]: { type: option.type, id: option.id } }); }}
            getOptionLabel={option => option.sublabel ? `${option.label} - ${option.sublabel}` : option.label}
            isOptionEqualToValue={(a, b) => a.type === b.type && a.id === b.id}
            renderInput={params => input(params, name, findOption(ownOptions, value[side].type, value[side].id))}
            renderOption={renderOption} autoHighlight disableClearable
            data-row-first={side === 'source' ? '' : undefined}
        />
    );
    const fields = <>
        {!row && <>
            <Typography variant="body2" color="text.secondary">{inserterMetadataText(value)}</Typography>
            {(!value.prototype || !value.quality) && <Typography variant="body2" color="text.secondary">{INSERTER_TIMING_ASSUMPTION}</Typography>}
        </>}
        <Box sx={row ? { ...PICKER_GROUP_SX, flexWrap: 'wrap' } : { display: 'contents' }}>
            {picker('source', 'Source')}
            <NearLaneSelect compact={row} source={value.source} belts={belts} entityLabel={label} onChange={source => onChange({ source })} />
        </Box>
        <Box sx={row ? { ...PICKER_GROUP_SX, gridColumn: { sm: 2, md: 'auto' } } : { display: 'contents' }}>
            {row && <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>→</Typography>}
            {picker('sink', 'Destination')}
        </Box>
        <Box sx={row ? ROW_REST_SX : { display: 'contents' }}>
            <NumberField id={`${row ? '' : 'diagram-'}inserter-stack-size-${value.id}`} label="Stack size" value={value.stack_size ?? null}
                placeholder="Automatic" helperText={inserterStackSizeHelp(value)} onValueChange={n => onChange({ stack_size: stackSizeFrom(n) })}
                min={1} step={1} sx={{ width: row ? 130 : '100%', maxWidth: '100%', alignSelf: 'start' }} size="small" />
            <Box sx={row ? { alignSelf: 'start', pt: '4px', minWidth: 0 } : { mt: 2 }}>
                <FilterSlotSelector filters={value.filters} inferredFilters={inferred} itemNames={itemNames} priority={priority}
                    onFilterChange={(slot, item) => filterChange(setFilterSlot(value.filters, inferred.slice(0, 5), slot, item))}
                    onRemoveFilter={slot => filterChange(removeFilterSlot(value.filters, inferred.slice(0, 5), slot))} />
                {!usesAutomaticFilters(value.filters) && inferred.length > 0 && <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Set by hand</Typography>
                    <Button size="small" color="inherit" onClick={() => { onChange({ filters: undefined }); announce(`${label}'s filters follow its source and destination again.`); }}>Use automatic filters</Button>
                </Box>}
            </Box>
            {row && rowActions}
        </Box>
    </>;
    return row ? fields : <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{fields}</Box>;
});
