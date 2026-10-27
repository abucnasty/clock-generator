import { ArrowForward } from '@mui/icons-material';
import { Box, Button, Typography } from '@mui/material';
import type { OutputTransferSummary } from 'clock-generator/browser';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useGameNames } from '../hooks/useGameNames';
import { sourceItemsOf } from '../utils/inferInserterItems';
import type { ResultTargetBuild } from '../utils/resultTarget';
import { chestLabel, entityLabel } from '../utils/entityLabel';
import { FactorioIcon } from './FactorioIcon';

interface InputRoutesPanelProps {
    machineId: number;
    build: ResultTargetBuild;
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    /** Recipe ingredients plus fuel, when known. */
    inputs: readonly string[];
    /** Null means route evidence has not been provided; an unavailable summary stays unavailable. */
    transfers: readonly OutputTransferSummary[] | null;
    loading?: boolean;
    onEditInserter?: (id: number) => void;
}

type Route = { item: string; label: string; detail: string; inserterId?: number; inferred?: boolean };

export function InputRoutesPanel({ machineId, build, getRecipeInfo, inputs, transfers, loading = false, onEditInserter }: InputRoutesPanelProps) {
    const { itemLabel } = useGameNames();
    const labelTarget = (target: { type: 'machine' | 'belt' | 'chest'; id: number }) => target.type === 'chest'
        ? chestLabel(build.chests.find(chest => chest.id === target.id) ?? { id: target.id })
        : entityLabel(target.type, target.id);
    const knownItems = new Set(inputs);
    const incomingInserters = build.inserters.filter(row => row.sink.type === 'machine' && row.sink.id === machineId);
    const missingMachineSourceSummary = incomingInserters.some(inserter => inserter.source.type === 'machine'
        && !(transfers ?? []).some(summary => summary.source.type === 'machine' && summary.source.id === inserter.source.id));
    const relevantSummaries = (transfers ?? []).filter(summary => summary.physical_target?.type === 'machine' && summary.physical_target.id === machineId
        || incomingInserters.some(inserter => inserter.source.type === 'machine' && summary.source.type === 'machine' && summary.source.id === inserter.source.id));
    let unavailable = transfers === null || missingMachineSourceSummary || relevantSummaries.some(summary => summary.status === 'unavailable');
    const rows = new Map<string, Route[]>();
    const unassigned: Route[] = [];
    const add = (route: Route) => {
        if (!knownItems.has(route.item)) { unassigned.push(route); return; }
        const routes = rows.get(route.item) ?? [];
        routes.push(route);
        rows.set(route.item, routes);
    };

    // Direct machine delivery and drill drops are incoming only when the engine explicitly accepted them.
    for (const summary of transfers ?? []) {
        if (summary.physical_target?.type !== 'machine' || summary.physical_target.id !== machineId) continue;
        if (summary.mechanism !== 'result-placement' && summary.mechanism !== 'mining-drop') continue;
        for (const result of summary.results) if (result.direct === 'accepted') {
            add({ item: result.item_name, label: summary.mechanism === 'mining-drop' ? 'Drill drop' : 'Direct machine output', detail: entityLabel(summary.source.type, summary.source.id) });
        }
    }

    // Configured physical output/drop targets remain visible when their evidence DTO is absent, but are never treated
    // as accepted routes without an engine result saying so.
    for (const machine of build.machines) if (machine.result_target?.type === 'machine' && machine.result_target.id === machineId
        && !(transfers ?? []).some(summary => summary.source.type === 'machine' && summary.source.id === machine.id)) {
        unavailable = true;
        unassigned.push({ item: '', label: 'Configured direct output', detail: `${entityLabel('machine', machine.id)} → ${entityLabel('machine', machineId)} · acceptance unavailable` });
    }
    for (const drill of build.drills) if (drill.target.type === 'machine' && drill.target.id === machineId
        && !(transfers ?? []).some(summary => summary.source.type === 'drill' && summary.source.id === drill.id)) {
        unavailable = true;
        unassigned.push({ item: '', label: 'Configured drill drop', detail: `${entityLabel('drill', drill.id)} → ${entityLabel('machine', machineId)} · acceptance unavailable` });
    }

    // Engine route facts are authoritative for machine-output sources. Other configured sources are visibly inferred
    // from their source contents, inserter filters, and receiving-machine inputs.
    for (const inserter of incomingInserters) {
        if (inserter.source.type === 'machine') {
            const summary = (transfers ?? []).find(candidate => candidate.source.type === 'machine' && candidate.source.id === inserter.source.id);
            if (summary) {
                let found = false;
                for (const result of summary.results) if (result.inserters.some(route => route.inserter_id === inserter.id && route.target.type === 'machine' && route.target.id === machineId)) {
                    found = true;
                    add({ item: result.item_name, label: 'Configured machine inserter', detail: `${entityLabel('machine', inserter.source.id)} → ${entityLabel('machine', machineId)}`, inserterId: inserter.id });
                }
                if (!found) unassigned.push({ item: '', label: 'Configured machine inserter', detail: `${entityLabel('machine', inserter.source.id)} → ${entityLabel('machine', machineId)} · ${summary.status === 'unavailable' ? 'other item routes unavailable' : 'no item route reported'}`, inserterId: inserter.id });
                continue;
            }
            unassigned.push({ item: '', label: 'Configured machine inserter', detail: `${entityLabel('machine', inserter.source.id)} → ${entityLabel('machine', machineId)} · item route unavailable`, inserterId: inserter.id });
            continue;
        }
        const source = sourceItemsOf(inserter.source, build.machines, build.belts, build.chests, getRecipeInfo, build.inserters, build.drills);
        if (source.length === 0) {
            unassigned.push({ item: '', label: 'Configured source connection', detail: `${labelTarget(inserter.source)} → ${entityLabel('machine', machineId)} · source items unavailable or none inferred`, inserterId: inserter.id });
            continue;
        }
        const items = source.filter(item => !inserter.filters?.length || (inserter.filter_mode === 'blacklist'
            ? !inserter.filters.includes(item) : inserter.filters.includes(item)));
        if (items.length === 0) {
            unassigned.push({ item: '', label: 'Configured source connection', detail: `${labelTarget(inserter.source)} → ${entityLabel('machine', machineId)} · all inferred items excluded by inserter filters`, inserterId: inserter.id });
            continue;
        }
        for (const item of items) {
            if (knownItems.has(item)) add({ item, label: 'From', detail: labelTarget(inserter.source), inserterId: inserter.id });
            else if (!knownItems.has(item)) unassigned.push({ item, label: 'Configured source connection', detail: `${labelTarget(inserter.source)} → ${entityLabel('machine', machineId)} · item not in known inputs`, inserterId: inserter.id, inferred: true });
        }
    }

    return <Box>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>Configured connections; timing and throughput are checked separately.</Typography>
        {loading && <Typography variant="body2" color="text.secondary">Checking input routes…</Typography>}
        {transfers === null && !loading && <Typography variant="body2" color="text.secondary">Input route details unavailable</Typography>}
        {relevantSummaries.some(summary => summary.status === 'unavailable') && <Typography variant="body2" color="text.secondary">Some input route details unavailable</Typography>}
        {inputs.length === 0 ? <Typography variant="body2" color="text.secondary">No known inputs</Typography> : inputs.map(item => {
            const routes = rows.get(item) ?? [];
            return <Box key={item} role="group" aria-label={itemLabel(item)} sx={{ display: 'flex', gap: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
                <FactorioIcon name={item} size={24} alt="" />
                <Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 600 }}>{itemLabel(item)}</Typography>
                    {routes.length ? routes.map((route, index) => <Box key={`${route.label}-${route.inserterId ?? index}`} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">{route.label}{route.label === 'From' ? ' ' : ': '}{route.detail}{route.inferred ? ' · configured' : ''}</Typography>
                        {route.inserterId !== undefined && onEditInserter && <Button size="small" sx={{ minHeight: 26, p: 0 }} onClick={() => onEditInserter(route.inserterId!)} aria-label={`Edit ${entityLabel('inserter', route.inserterId)}`}><ArrowForward sx={{ fontSize: 14, mr: 0.25 }} />{entityLabel('inserter', route.inserterId)}</Button>}
                    </Box>) : <Typography variant="body2" color="text.secondary">{unavailable ? 'Input routes unavailable' : 'No known incoming route'}</Typography>}
                </Box>
            </Box>;
        })}
        {unassigned.length > 0 && <Box sx={{ mt: 1 }}><Typography variant="body2" sx={{ fontWeight: 600 }}>Unassigned configured connections</Typography>
            {unassigned.map((route, index) => <Box key={`${route.inserterId}-${index}`} sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">{route.item ? `${itemLabel(route.item)} · ` : ''}{route.label}: {route.detail}</Typography>
                {route.inserterId !== undefined && onEditInserter && <Button size="small" sx={{ minHeight: 26, p: 0 }} onClick={() => onEditInserter(route.inserterId!)} aria-label={`Edit ${entityLabel('inserter', route.inserterId)}`}><ArrowForward sx={{ fontSize: 14, mr: 0.25 }} />{entityLabel('inserter', route.inserterId)}</Button>}
            </Box>)}</Box>}
    </Box>;
}
