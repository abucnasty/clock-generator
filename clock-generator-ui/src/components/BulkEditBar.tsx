import { Box, Button, Popover, Typography } from '@mui/material';
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import type { InserterFormData } from '../hooks/useConfigForm';
import { commonValue, selectionLabel } from '../utils/bulkEdit';
import { effectiveInserterStackSize } from '../utils/inserterMetadata';
import { removeFilterSlot, setFilterSlot } from '../utils/inserterFilters';
import { stackSizeFrom } from '../utils/inserterOptions';
import type { BulkEditKind } from '../utils/undoSnapshot';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { EnableControlModal } from './EnableControlModal';
import { FilterSlotSelector } from './FilterSlotSelector';
import { NumberField } from './NumberField';

interface BulkEditBarProps {
    selected: InserterFormData[];
    filtersOnly?: boolean;
    total: number;
    priorityIds: string[];
    availableItems: string[];
    itemNames: string[];
    onSelectAll: () => void;
    onClear: () => void;
    onDone?: () => void;
    onReturnFocus: () => void;
    onApply: (updates: Partial<InserterFormData>, kind: BulkEditKind) => void;
}

/** Draft controls apply exactly one chosen field to the selected rows. */
export function BulkEditBar({ selected, filtersOnly = false, total, priorityIds, availableItems, itemNames, onSelectAll, onClear, onDone, onReturnFocus, onApply }: BulkEditBarProps) {
    const barRef = useRef<HTMLDivElement>(null);
    const [stack, setStack] = useState<number | null>(() => commonValue(selected, row => row.stack_size) ?? null);
    const [filtersAnchor, setFiltersAnchor] = useState<HTMLButtonElement | null>(null);
    const [filters, setFilters] = useState<string[]>(() => commonValue(selected, row => row.filters) ?? []);
    const [filterDraftEdited, setFilterDraftEdited] = useState(false);
    const sharedFilters = commonValue(selected, row => row.filters);
    const empty = selected.length === 0;
    const mixedFilters = !empty && sharedFilters === null && !filterDraftEdited;
    const [ruleOpen, setRuleOpen] = useState(false);
    const filtersId = useId();
    const titleId = useId();
    const label = selectionLabel(selected.map(row => row.id));
    const sharedRule = commonValue(selected, row => row.overrides?.enable_control);
    const validStack = stack === null || (Number.isInteger(stack) && stack >= 1);

    useLayoutEffect(() => {
        const bar = barRef.current;
        return () => { if (bar?.contains(document.activeElement)) onReturnFocus(); };
    }, [onReturnFocus]);

    useEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        const root = document.documentElement;
        const revealFocus = () => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement) || !active.closest('main') || bar.contains(active)) return;
            const box = active.getBoundingClientRect();
            const barBox = bar.getBoundingClientRect();
            const headerHeight = parseFloat(getComputedStyle(root).getPropertyValue('--app-header-height')) || 0;
            if (barBox.top <= headerHeight + 1 && box.top < barBox.bottom && box.bottom > headerHeight) active.scrollIntoView({ block: 'nearest' });
        };
        const observer = new ResizeObserver(() => {
            root.style.setProperty('--sticky-under-header', `${bar.getBoundingClientRect().height}px`);
            revealFocus();
        });
        observer.observe(bar);
        document.addEventListener('focusin', revealFocus);
        return () => {
            observer.disconnect();
            document.removeEventListener('focusin', revealFocus);
            root.style.removeProperty('--sticky-under-header');
        };
    }, []);

    const filterSelection = JSON.stringify(selected.map(row => [row._uuid, row.filters]));
    const [filterSource, setFilterSource] = useState(filterSelection);
    if (filterSource !== filterSelection) {
        setFilterSource(filterSelection);
        setFilters(sharedFilters ?? []);
        setFilterDraftEdited(false);
    }
    const stackSelection = JSON.stringify(selected.map(row => [row._uuid, row.stack_size]));
    const [stackSource, setStackSource] = useState(stackSelection);
    if (stackSource !== stackSelection) {
        setStackSource(stackSelection);
        setStack(commonValue(selected, row => row.stack_size) ?? null);
    }

    const closeFilters = () => setFiltersAnchor(null);
    return <Box ref={barRef} role="region" aria-label="Edit selected inserters" data-bulk-edit=""
        sx={{ position: 'sticky', top: 'var(--app-header-height)', zIndex: 2, bgcolor: (theme: Theme) => themeTokens(theme).surface.titleBar, border: 1, borderColor: 'divider', p: 1.5, mb: 2, display: 'flex', columnGap: 2, rowGap: 1, alignItems: 'center', flexWrap: 'wrap', containerType: 'inline-size', containerName: 'bulk-edit-bar', '& .MuiButton-root': { minHeight: 40, boxSizing: 'border-box' } }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', pr: { xs: 0, md: 2 }, borderRight: { xs: 0, md: 1 }, borderColor: 'divider', '@container bulk-edit-bar (max-width: 1000px)': { flexBasis: '100%', pr: 0, borderRight: 0 } }}>
        <Typography variant="body2" role="status" sx={{ fontWeight: 600 }}>{selected.length} {selected.length === 1 ? 'inserter' : 'inserters'} selected</Typography>
        <Button color="inherit" size="small" onClick={onSelectAll} disabled={selected.length === total}>Select all</Button>
        <Button color="inherit" size="small" onClick={onClear} disabled={empty}>Clear selection</Button>
        {onDone && <Button color="inherit" size="small" onClick={onDone}>Done</Button>}
        </Box>
        <Box component="fieldset" disabled={empty} aria-label="Bulk changes" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', minWidth: 0, flex: '1 1 300px', border: 0, p: 0, m: 0, '@container bulk-edit-bar (max-width: 1000px)': { flexBasis: '100%' }, ...(empty && { opacity: 0.5, pointerEvents: 'none' }) }}>
        {filtersOnly ? <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <Box>
                {mixedFilters && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Mixed filters — choose a set to apply</Typography>}
            <FilterSlotSelector filters={filters} itemNames={itemNames} priority={{ label: 'From selected sources', ids: priorityIds }}
                onFilterChange={(slot, item) => { setFilterDraftEdited(true); setFilters(setFilterSlot(filters, [], slot, item).filters ?? []); }}
                onRemoveFilter={slot => { setFilterDraftEdited(true); setFilters(removeFilterSlot(filters, [], slot).filters ?? []); }} />
            </Box>
            <Button variant="outlined" color="inherit" size="small" disabled={empty || filters.length === 0 || mixedFilters} onClick={() => onApply({ filters }, 'filters')}>Apply filters to {selected.length}</Button>
            </Box>
            <Button variant="outlined" color="inherit" size="small" onClick={() => onApply({ filters: undefined }, 'auto-filters')}>Use Automatic for {selected.length}</Button>
        </> : <>
        <Box sx={{ display: 'flex', alignItems: 'start', gap: 1 }}>
            <NumberField label="Stack size" value={stack} onValueChange={value => setStack(value)} placeholder="Automatic"
                step={1} size="small" preserveInputOnBlur problem={!validStack ? 'Enter a whole number of at least 1, or clear for Automatic.' : undefined} sx={{ width: 130 }} />
            <Button variant="outlined" color="inherit" size="small" onClick={() => onApply({ stack_size: stackSizeFrom(stack) }, 'stack')} disabled={!validStack}>Set</Button>
        </Box>
        <Button variant="outlined" color="inherit" size="small" onClick={event => {
            setFilters(commonValue(selected, row => row.filters) ?? []);
            setFilterDraftEdited(false);
            setFiltersAnchor(event.currentTarget);
        }} aria-haspopup="dialog" aria-expanded={filtersAnchor !== null} aria-controls={filtersAnchor ? filtersId : undefined}>Filters…</Button>
        <Button variant="outlined" color="inherit" size="small" onClick={() => setRuleOpen(true)}>Enable rule…</Button>
        </>}
        </Box>
        <Popover open={filtersAnchor !== null} anchorEl={filtersAnchor} onClose={closeFilters}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            slotProps={{ paper: { id: filtersId, role: 'dialog', 'aria-labelledby': titleId, sx: { width: 380, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto' } } }}>
            <Box sx={{ p: 2 }}>
                <Typography id={titleId} component="h2" variant="subtitle1" sx={{ mb: 1.5 }}>Edit selected inserter filters</Typography>
                {mixedFilters && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Mixed filters — choose a set to apply</Typography>}
                <FilterSlotSelector filters={filters} itemNames={itemNames} priority={{ label: "From the selected inserters' sources", ids: priorityIds }}
                    onFilterChange={(slot, item) => { setFilterDraftEdited(true); setFilters(setFilterSlot(filters, [], slot, item).filters ?? []); }}
                    onRemoveFilter={slot => { setFilterDraftEdited(true); setFilters(removeFilterSlot(filters, [], slot).filters ?? []); }} />
                <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Button color="inherit" variant="outlined" disabled={mixedFilters} onClick={() => { closeFilters(); onApply({ filters: filters.length > 0 ? filters : undefined }, 'filters'); }}>Apply</Button>
                    <Button color="inherit" onClick={() => { closeFilters(); onApply({ filters: undefined }, 'auto-filters'); }}>Use automatic filters</Button>
                    <Button color="inherit" onClick={closeFilters}>Cancel</Button>
                </Box>
            </Box>
        </Popover>
        <EnableControlModal open={ruleOpen} onClose={() => setRuleOpen(false)} entityType="inserter" entityId={0} entityLabel={label}
            currentOverride={sharedRule ?? undefined} applyUnchanged={sharedRule === null}
            sourceType={commonValue(selected, row => row.source.type) ?? undefined} sinkType={commonValue(selected, row => row.sink.type) ?? undefined}
            stackSize={commonValue(selected, effectiveInserterStackSize) ?? undefined}
            availableItems={availableItems} movedItems={priorityIds}
            onSave={override => onApply({ overrides: { enable_control: override } }, 'rule')} />
    </Box>;
}
