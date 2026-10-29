import type { ChestConfig, Config, InserterConfig } from './schema';
import { FactorioDataService } from '../data/factorio-data-service';
import { expectedAmount } from '../entities/machine/recipe/recipe-metadata';
import { machineFuelOf, machinePlacesResults } from './machine-prototype';

export interface OutputTransferTarget { type: 'machine' | 'belt' | 'chest'; id: number }
export interface OutputTransferResult {
    item_name: string;
    direct: 'accepted' | 'rejected' | 'none' | 'unknown';
    /** Candidate real routes. Direct placement has priority; these do not promise a selectable split. */
    inserters: { inserter_id: number; target: OutputTransferTarget }[];
    coverage: 'covered' | 'missing' | 'unknown';
}
export interface OutputTransferSummary {
    source: { type: 'machine' | 'drill'; id: number };
    physical_target: { type: 'machine' | 'chest'; id: number } | null;
    mechanism: 'result-placement' | 'mining-drop' | 'inserters';
    status: 'known' | 'unavailable';
    results: OutputTransferResult[];
}

export function filtersExclude(inserter: Pick<InserterConfig, 'filters' | 'filter_mode'>, item: string): boolean {
    if (!inserter.filters?.length) return false;
    return inserter.filter_mode === 'blacklist' ? inserter.filters.includes(item) : !inserter.filters.includes(item);
}

/** Configured acceptance, not free space or a promise of downstream removal. */
function configuredChestAcceptance(chest: ChestConfig, item: string): boolean | undefined {
    if (chest.type === 'infinity-chest') return chest.remove_unfiltered_items === true || chest.item_filter.some(filter => filter.item_name === item);
    if (chest.type === 'buffer-chest') return chest.item_filter === item;
    if (chest.type === 'rocket-silo') return true;
    const filters = new Map((chest.slot_filters ?? []).map(filter => [filter.slot, filter.item]));
    if ([...filters.values()].includes(item)) return true;
    try { return filters.size < FactorioDataService.containerSlots(chest.type, ('quality' in chest ? chest.quality : undefined) ?? 'normal'); }
    catch { return undefined; }
}

/** Existing ordinary-source coverage treats unavailable slot-count data conservatively. */
export function chestAcceptsItem(chest: ChestConfig, item: string): boolean {
    return configuredChestAcceptance(chest, item) ?? true;
}

type Topology = Pick<Config, 'machines' | 'belts' | 'chests'>;

/** undefined means missing entities or unavailable data, never assumed acceptance. */
function targetAcceptsItem(target: OutputTransferTarget, item: string, config: Topology, direct: boolean): boolean | undefined {
    if (target.type === 'chest') {
        const chest = config.chests?.find(chest => chest.id === target.id);
        return chest === undefined ? undefined : configuredChestAcceptance(chest, item);
    }
    if (target.type === 'belt') {
        const belt = config.belts.find(belt => belt.id === target.id);
        // Normal output belts historically stand for removal too: the inserter factory falls back to a lane
        // even when its configured supply ingredient differs. Acceptance is not proof of downstream capacity.
        if (belt === undefined || Number(belt.lanes.length) === 0 || belt.lanes.some(lane => !Number.isFinite(lane.stack_size) || lane.stack_size <= 0)) return undefined;
        return true;
    }
    const machine = config.machines.find(machine => machine.id === target.id);
    if (machine === undefined) return undefined;
    try {
        if (FactorioDataService.findRecipeOrThrow(machine.recipe).ingredients.some(input => input.name === item)) return true;
        if (direct) return false;
        return machineFuelOf(machine) === item;
    } catch { return undefined; }
}

export function outputInserterAcceptsItem(inserter: InserterConfig, item: string, config: Topology): boolean | undefined {
    if (filtersExclude(inserter, item)) return false;
    if (inserter.sink.type === 'belt' && inserter.sink.drop !== undefined) {
        const belt = config.belts.find(belt => belt.id === inserter.sink.id);
        if (belt === undefined || inserter.sink.drop.lane > belt.lanes.length) return undefined;
    }
    return targetAcceptsItem(inserter.sink, item, config, false);
}

/**
 * Read-only physical layout and item coverage. No registry, rate planning, simulation or generation eligibility is
 * implied. Every item result remains visible, including results rejected by the one physical destination.
 */
export function deriveOutputTransfers(config: Config): OutputTransferSummary[] {
    const summarize = (source: OutputTransferSummary['source'], physical_target: OutputTransferSummary['physical_target'],
        mechanism: OutputTransferSummary['mechanism'], items: string[] | undefined): OutputTransferSummary => {
        let unavailable = items === undefined;
        const results = (items ?? []).map((item): OutputTransferResult => {
            const accepts = physical_target === null ? false : mechanism === 'inserters' ? undefined : targetAcceptsItem(physical_target, item, config, true);
            const direct = physical_target === null ? 'none' : accepts === undefined ? 'unknown' : accepts ? 'accepted' : 'rejected';
            let unknown = accepts === undefined;
            const inserters: OutputTransferResult['inserters'] = [];
            const seen = new Set<number>();
            if (source.type === 'machine') config.inserters.forEach((inserter, index) => {
                if (inserter.source.type !== 'machine' || inserter.source.id !== source.id) return;
                const id = inserter.id ?? index + 1;
                if (seen.has(id)) { unknown = true; return; }
                seen.add(id);
                const accepted = outputInserterAcceptsItem(inserter, item, config);
                if (accepted === undefined) unknown = true;
                if (accepted) inserters.push({ inserter_id: id, target: { type: inserter.sink.type, id: inserter.sink.id } });
            });
            unavailable ||= unknown;
            return { item_name: item, direct, inserters, coverage: accepts || inserters.length > 0 ? 'covered' : unknown ? 'unknown' : 'missing' };
        });
        return { source, physical_target, mechanism, status: unavailable ? 'unavailable' : 'known', results };
    };
    return [
        ...config.machines.map(machine => {
            let items: string[] | undefined;
            try {
                const results = FactorioDataService.findRecipeOrThrow(machine.recipe).results;
                const main = results.reduce((best, result, index) => expectedAmount(result) > expectedAmount(results[best]) ? index : best, 0);
                items = results.length === 0 ? [] : [results[main], ...results.filter((_, index) => index !== main)].map(result => result.name);
            } catch { /* Unavailable facts stay unknown. */ }
            let mechanism: OutputTransferSummary['mechanism'] = 'inserters';
            try { if (machinePlacesResults(machine)) mechanism = 'result-placement'; } catch { items = undefined; }
            return summarize({ type: 'machine', id: machine.id }, machine.result_target ?? null, mechanism, items);
        }),
        ...(config.drills?.configs ?? []).map(drill => {
            let items: string[] | undefined;
            try { items = [FactorioDataService.getResourceOrThrow(drill.mined_item_name).minable.result]; } catch { /* Unknown resource. */ }
            return summarize({ type: 'drill', id: drill.id }, drill.target, 'mining-drop', items);
        }),
    ];
}
