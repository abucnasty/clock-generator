import { Config, BeltConfig, ChestConfig, InserterConfig, MachineConfiguration, MiningDrillConfig } from './schema';
import { FactorioDataService } from '../data/factorio-data-service';
import { BurnerEnergySource } from '../entities';
import { machineRuleOf } from './machine-prototype';
import { InserterCoverageError, InserterCoverageIssue, InserterFixOption } from './errors';
import { assertInsertersInScope } from './inserter-scope';

// ============================================================================
// Item-source coverage helpers
// ============================================================================

function beltCoversItem(belt: BeltConfig, itemName: string): boolean {
    return belt.lanes.some((lane) => lane.ingredient === itemName);
}

/**
 * Whether a chest can give the item. A car, a tank, a cargo wagon or a rocket silo holds mixed items, put in by the build
 * or there from the start, so it can give any item; what it gives is checked when the build is simulated.
 */
function chestSuppliesItem(chest: ChestConfig, itemName: string): boolean {
    if (chest.type === 'buffer-chest') {
        return chest.item_filter === itemName;
    }
    if (chest.type === 'infinity-chest') {
        return chest.item_filter.some((f) => f.item_name === itemName && f.request_count > 0);
    }
    return true;
}

/** Whether a chest names the item: its filter, its supply, or for a chest of mixed items its contents or slot filters */
function chestNamesItem(chest: ChestConfig, itemName: string): boolean {
    if (chest.type === 'buffer-chest' || chest.type === 'infinity-chest') {
        return chestSuppliesItem(chest, itemName);
    }
    const slot_filters = 'slot_filters' in chest ? chest.slot_filters ?? [] : [];
    return (chest.contents ?? []).some(content => content.item === itemName) || slot_filters.some(filter => filter.item === itemName);
}

export function chestAcceptsItem(chest: ChestConfig, itemName: string): boolean {
    if (chest.type === 'infinity-chest') {
        return chest.remove_unfiltered_items === true || chest.item_filter.some(filter => filter.item_name === itemName);
    }
    if (chest.type === 'buffer-chest') {
        return chestSuppliesItem(chest, itemName);
    }
    if (chest.type === 'rocket-silo') {
        return true;
    }
    // a slot filtered to another item does not take it; one free slot is enough
    const filtered = new Map((chest.slot_filters ?? []).map(filter => [filter.slot, filter.item]));
    return (chest.slot_filters ?? []).some(filter => filter.item === itemName)
        || !isEverySlotFiltered(chest.type, ('quality' in chest ? chest.quality : undefined) ?? 'normal', filtered.size);
}

/** Whether a container's every slot is filtered; its slot count is the game data's, so without the data it is not */
function isEverySlotFiltered(type: 'car' | 'tank' | 'cargo-wagon', quality: string, filtered: number): boolean {
    if (!FactorioDataService.isAvailable()) {
        return false;
    }
    try {
        return filtered >= FactorioDataService.containerSlots(type, quality);
    } catch {
        return false;
    }
}

/** Whether the inserter's own filters keep it from moving the item: a whitelist without it, or a blacklist with it */
export function filtersExclude(inserter: InserterConfig, itemName: string): boolean {
    if (!inserter.filters?.length) return false;
    return inserter.filter_mode === 'blacklist' ? inserter.filters.includes(itemName) : !inserter.filters.includes(itemName);
}

/** Returns true if this inserter carries `itemName` into machine `machineId`. */
function inserterCoversInputItem(
    inserter: InserterConfig,
    machineId: number,
    itemName: string,
    belts: BeltConfig[],
    chests: ChestConfig[],
    machines: MachineConfiguration[],
): boolean {
    if (inserter.sink.type !== 'machine' || inserter.sink.id !== machineId) {
        return false;
    }
    // If the inserter has explicit filters that exclude this item, it doesn't cover it
    if (filtersExclude(inserter, itemName)) {
        return false;
    }
    const source = inserter.source;
    if (source.type === 'belt') {
        const belt = belts.find((b) => b.id === source.id);
        return belt !== undefined && beltCoversItem(belt, itemName);
    }
    if (source.type === 'chest') {
        const chest = chests.find((c) => c.id === source.id);
        return chest !== undefined && chestSuppliesItem(chest, itemName);
    }
    if (source.type === 'machine') {
        // A machine→machine inserter covers the item if the source machine's
        // recipe actually produces it.
        const sourceMachine = machines.find((m) => m.id === source.id);
        if (!sourceMachine) return false;
        try {
            const sourceRecipe = FactorioDataService.findRecipeOrThrow(sourceMachine.recipe);
            return sourceRecipe.results.some((r) => r.name === itemName);
        } catch {
            return false;
        }
    }
    return false;
}

/** Returns true if this drill directly feeds `itemName` into machine `machineId`. */
function drillCoversInputItem(
    drill: MiningDrillConfig,
    machineId: number,
    itemName: string,
): boolean {
    return drill.target.type === 'machine' && drill.target.id === machineId && drill.mined_item_name === itemName;
}

/** Returns true if this inserter carries `itemName` out of machine `machineId`. */
function inserterCoversOutputItem(
    inserter: InserterConfig,
    machineId: number,
    itemName: string,
    chests: ChestConfig[],
): boolean {
    if (inserter.source.type !== 'machine' || inserter.source.id !== machineId) {
        return false;
    }
    if (filtersExclude(inserter, itemName)) {
        return false;
    }
    if (inserter.sink.type === 'chest') {
        const chest = chests.find(chest => chest.id === inserter.sink.id);
        return chest !== undefined && chestAcceptsItem(chest, itemName);
    }
    return true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validates that every machine ingredient, burner fuel and output item in the config has at
 * least one inserter covering it.
 *
 * Each missing ingredient/output produces a separate `InserterCoverageIssue`
 * — the loop never returns early so ALL missing items are reported.
 *
 * Returns an empty array while the game data cannot be read, so this is safe to call from the browser before the data
 * is loaded. In Node the data is read on first use, here too: a check that comes first is not skipped.
 */
function coverageForMachines(config: Config, checkedMachines: MachineConfiguration[]): InserterCoverageIssue[] {
    if (!FactorioDataService.isAvailable()) {
        return [];
    }

    const issues: InserterCoverageIssue[] = [];
    const belts = config.belts;
    const chests = config.chests ?? [];
    const machines = config.machines;

    for (const machine of checkedMachines) {
        let recipe;
        try {
            recipe = FactorioDataService.findRecipeOrThrow(machine.recipe);
        } catch {
            // Recipe not found in data — skip this machine
            continue;
        }

        // ── Input ingredients ────────────────────────────────────────────────
        const drills = config.drills?.configs ?? [];
        // A burner machine also needs its fuel inserted
        const burner = BurnerEnergySource.forMachineType(machineRuleOf(machine));
        const inputItemNames = recipe.ingredients.map((ingredient) => ingredient.name);
        const fuelItem = burner ? BurnerEnergySource.selectFuel(burner, machine.fuel).item_name : undefined;
        if (fuelItem) inputItemNames.push(fuelItem);
        for (const itemName of new Set(inputItemNames)) {
            const covered =
                config.inserters.some((ins) =>
                    inserterCoversInputItem(ins, machine.id, itemName, belts, chests, machines),
                ) ||
                drills.some((drill) => drillCoversInputItem(drill, machine.id, itemName));

            if (!covered) {
                const fixOptions: InserterFixOption[] = [];
                const blocked = config.inserters.filter(ins => filtersExclude(ins, itemName)
                    && inserterCoversInputItem({ ...ins, filters: undefined }, machine.id, itemName, belts, chests, machines));
                blocked.forEach(ins => fixOptions.push({ type: 'review_filters', inserter_id: ins.id ?? config.inserters.indexOf(ins) + 1, item_name: itemName }));
                const alreadyConnected = (type: 'machine' | 'belt' | 'chest', id: number) => blocked.some(ins => ins.source.type === type && ins.source.id === id);
                for (const belt of belts) {
                    if (beltCoversItem(belt, itemName) && !alreadyConnected('belt', belt.id))
                        fixOptions.push({ type: 'existing_connection', endpoint_type: 'belt', endpoint_id: belt.id, item_name: itemName });
                }
                for (const chest of chests) {
                    if (chestNamesItem(chest, itemName) && !alreadyConnected('chest', chest.id))
                        fixOptions.push({ type: 'existing_connection', endpoint_type: 'chest', endpoint_id: chest.id, item_name: itemName });
                }

                // Highest-priority fix: if another machine in the config
                // already produces this ingredient, prefer a machine→machine inserter.
                for (const other of config.machines) {
                    if (other.id === machine.id || alreadyConnected('machine', other.id)) continue;
                    let otherRecipe;
                    try {
                        otherRecipe = FactorioDataService.findRecipeOrThrow(other.recipe);
                    } catch {
                        continue;
                    }
                    if (otherRecipe.results.some((r) => r.name === itemName)) {
                        fixOptions.push({
                            type: 'machine_to_machine',
                            source_machine_id: other.id,
                            item_name: itemName,
                        });
                    }
                }

                // Next: add a lane to an existing belt that already feeds this
                // machine and still has a free lane.
                for (const belt of belts) {
                    const feedsMachine = config.inserters.some(
                        (ins) =>
                            ins.source.type === 'belt' &&
                            ins.source.id === belt.id &&
                            ins.sink.type === 'machine' &&
                            ins.sink.id === machine.id &&
                            !filtersExclude(ins, itemName),
                    );
                    if (feedsMachine && belt.lanes.length < 2 && !beltCoversItem(belt, itemName)) {
                        fixOptions.push({
                            type: 'add_lane_to_existing_belt',
                            belt_id: belt.id,
                            item_name: itemName,
                        });
                    }
                }

                fixOptions.push({ type: 'new_belt', item_name: itemName });
                fixOptions.push({ type: 'infinity_chest', item_name: itemName });

                issues.push({
                    kind: 'missing_input_inserter',
                    machine_id: machine.id,
                    recipe: machine.recipe,
                    item_name: itemName,
                    ...(itemName === fuelItem && { is_fuel: true }),
                    fix_options: fixOptions,
                });
            }
        }

        // ── Output results ───────────────────────────────────────────────────
        // a machine that places its results itself puts them into its result target, which covers what it takes
        const resultTarget = machine.result_target === undefined ? undefined : chests.find(chest => chest.id === machine.result_target!.id);
        for (const result of recipe.results) {
            const itemName = result.name;
            const covered = (resultTarget !== undefined && chestAcceptsItem(resultTarget, itemName))
                || config.inserters.some((ins) =>
                    inserterCoversOutputItem(ins, machine.id, itemName, chests),
                );

            if (!covered) {
                const fixOptions: InserterFixOption[] = [];
                const blocked = config.inserters.filter(ins => filtersExclude(ins, itemName)
                    && inserterCoversOutputItem({ ...ins, filters: undefined }, machine.id, itemName, chests));
                blocked.forEach(ins => fixOptions.push({ type: 'review_filters', inserter_id: ins.id ?? config.inserters.indexOf(ins) + 1, item_name: itemName }));
                const alreadyConnected = (type: 'machine' | 'belt' | 'chest', id: number) => blocked.some(ins => ins.sink.type === type && ins.sink.id === id);
                for (const belt of belts) {
                    if (beltCoversItem(belt, itemName) && !alreadyConnected('belt', belt.id))
                        fixOptions.push({ type: 'existing_connection', endpoint_type: 'belt', endpoint_id: belt.id, item_name: itemName });
                }
                for (const chest of chests) {
                    if (chestAcceptsItem(chest, itemName) && !alreadyConnected('chest', chest.id))
                        fixOptions.push({ type: 'existing_connection', endpoint_type: 'chest', endpoint_id: chest.id, item_name: itemName });
                }
                for (const other of machines) {
                    if (other.id === machine.id || alreadyConnected('machine', other.id)) continue;
                    try {
                        const needs = FactorioDataService.findRecipeOrThrow(other.recipe).ingredients.some(item => item.name === itemName);
                        const energy = BurnerEnergySource.forMachineType(machineRuleOf(other));
                        if (needs || (energy && BurnerEnergySource.selectFuel(energy, other.fuel).item_name === itemName))
                            fixOptions.push({ type: 'existing_connection', endpoint_type: 'machine', endpoint_id: other.id, item_name: itemName });
                    } catch { /* Unknown recipes cannot be offered as destinations. */ }
                }
                issues.push({
                    kind: 'missing_output_inserter',
                    machine_id: machine.id,
                    recipe: machine.recipe,
                    item_name: itemName,
                    fix_options: [
                        ...fixOptions,
                        { type: 'new_belt', item_name: itemName },
                        { type: 'infinity_chest', item_name: itemName },
                    ],
                });
            }
        }
    }

    return issues;
}

/** A full, uncached check for generation and other independent callers. */
export function validateInserterCoverage(config: Config): InserterCoverageIssue[] {
    return coverageForMachines(config, config.machines);
}

/**
 * The live editor reuses each machine's result until its routes or available item sources change.
 * Keep this cache scoped to one worker and replace it each call, so removed machines do not accumulate.
 */
export function createInserterCoverageValidator(): (config: Config) => InserterCoverageIssue[] {
    let catalog = '';
    let cached = new Map<number, { key: string; issues: InserterCoverageIssue[] }>();
    return config => {
        if (!FactorioDataService.isAvailable()) return [];
        const nextCatalog = JSON.stringify({
            machines: config.machines.map(({ id, recipe, prototype, fuel, result_target }) => [id, recipe, prototype, fuel, result_target?.id]),
            belts: config.belts.map(({ id, lanes }) => [id, lanes.map(lane => lane.ingredient)]),
            chests: config.chests?.map(chest => [chest.id, chest.type, chest.type === 'buffer-chest' ? chest.item_filter
                : chest.type === 'infinity-chest' ? [chest.remove_unfiltered_items ?? false, ...chest.item_filter.map(filter => [filter.item_name, filter.request_count > 0])]
                    : [chest.contents ?? [], 'slot_filters' in chest ? chest.slot_filters ?? [] : []]]),
        });
        if (catalog !== nextCatalog) { cached.clear(); catalog = nextCatalog; }
        const routes = new Map<number, unknown[]>();
        config.inserters.forEach((inserter, index) => {
            const route = [inserter.id ?? index + 1, inserter.source.type, inserter.source.id, inserter.sink.type, inserter.sink.id, inserter.filters, inserter.filter_mode];
            const ids = new Set<number>();
            if (inserter.source.type === 'machine') ids.add(inserter.source.id);
            if (inserter.sink.type === 'machine') ids.add(inserter.sink.id);
            for (const id of ids) {
                const own = routes.get(id) ?? [];
                own.push(route);
                routes.set(id, own);
            }
        });
        const drills = new Map<number, string[]>();
        for (const drill of config.drills?.configs ?? []) {
            if (drill.target.type !== 'machine') continue;
            const own = drills.get(drill.target.id) ?? [];
            own.push(drill.mined_item_name);
            drills.set(drill.target.id, own);
        }
        const next = new Map<number, { key: string; issues: InserterCoverageIssue[] }>();
        const issues: InserterCoverageIssue[] = [];
        for (const machine of config.machines) {
            const key = JSON.stringify([routes.get(machine.id), drills.get(machine.id)]);
            const previous = cached.get(machine.id);
            const result = previous?.key === key ? previous : { key, issues: coverageForMachines(config, [machine]) };
            next.set(machine.id, result);
            issues.push(...result.issues);
        }
        cached = next;
        return issues;
    };
}

/**
 * Throws an `InserterCoverageError` if any inserter coverage issues are found.
 * Intended to be called at the start of blueprint generation.
 */
export function assertInserterCoverage(config: Config): void {
    assertInsertersInScope(config);
    const issues = validateInserterCoverage(config);
    if (issues.length > 0) {
        throw new InserterCoverageError(issues);
    }
}
