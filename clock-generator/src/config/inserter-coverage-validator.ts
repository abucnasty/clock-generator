import { Config, BeltConfig, ChestConfig, InserterConfig, MachineConfiguration, MiningDrillConfig } from './schema';
import { FactorioDataService } from '../data/factorio-data-service';
import { BurnerEnergySource, MachineType } from '../entities';
import { InserterCoverageError, InserterCoverageIssue, InserterFixOption } from './errors';

// ============================================================================
// Item-source coverage helpers
// ============================================================================

function beltCoversItem(belt: BeltConfig, itemName: string): boolean {
    return belt.lanes.some((lane) => lane.ingredient === itemName);
}

function chestSuppliesItem(chest: ChestConfig, itemName: string): boolean {
    if (chest.type === 'buffer-chest') {
        return chest.item_filter === itemName;
    }
    // infinity-chest
    return chest.item_filter.some((f) => f.item_name === itemName && f.request_count > 0);
}

function chestAcceptsItem(chest: ChestConfig, itemName: string): boolean {
    return chest.type === 'infinity-chest' ? chest.remove_unfiltered_items === true || chest.item_filter.some(filter => filter.item_name === itemName) : chestSuppliesItem(chest, itemName);
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
    if (inserter.filters && inserter.filters.length > 0 && !inserter.filters.includes(itemName)) {
        return false;
    }
    const source = inserter.source;
    if (source.type === 'belt') {
        const belt = belts.find((b) => b.id === source.id);
        return belt !== undefined && (beltCoversItem(belt, itemName)
            || source.pickup_merge?.inner.ingredient === itemName || source.pickup_merge?.outer.ingredient === itemName);
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
    return drill.target.id === machineId && drill.mined_item_name === itemName;
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
    if (inserter.filters && inserter.filters.length > 0 && !inserter.filters.includes(itemName)) {
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
 * Returns an empty array if `FactorioDataService` has not been initialized yet,
 * so this is safe to call from the browser before data is loaded.
 */
function coverageForMachines(config: Config, checkedMachines: MachineConfiguration[]): InserterCoverageIssue[] {
    if (!FactorioDataService.isInitialized()) {
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
        const burner = BurnerEnergySource.forMachineType(machine.type ?? MachineType.MACHINE);
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
                const blocked = config.inserters.filter(ins => ins.filters?.length && !ins.filters.includes(itemName)
                    && inserterCoversInputItem({ ...ins, filters: undefined }, machine.id, itemName, belts, chests, machines));
                blocked.forEach(ins => fixOptions.push({ type: 'review_filters', inserter_id: ins.id ?? config.inserters.indexOf(ins) + 1, item_name: itemName }));
                const alreadyConnected = (type: 'machine' | 'belt' | 'chest', id: number) => blocked.some(ins => ins.source.type === type && ins.source.id === id);
                for (const belt of belts) {
                    if (beltCoversItem(belt, itemName) && !alreadyConnected('belt', belt.id))
                        fixOptions.push({ type: 'existing_connection', endpoint_type: 'belt', endpoint_id: belt.id, item_name: itemName });
                }
                for (const chest of chests) {
                    if (chestSuppliesItem(chest, itemName) && !alreadyConnected('chest', chest.id))
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
                            (!ins.filters?.length || ins.filters.includes(itemName)),
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
        for (const result of recipe.results) {
            const itemName = result.name;
            const covered = config.inserters.some((ins) =>
                inserterCoversOutputItem(ins, machine.id, itemName, chests),
            );

            if (!covered) {
                const fixOptions: InserterFixOption[] = [];
                const blocked = config.inserters.filter(ins => ins.filters?.length && !ins.filters.includes(itemName)
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
                        const energy = BurnerEnergySource.forMachineType(other.type ?? MachineType.MACHINE);
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
        if (!FactorioDataService.isInitialized()) return [];
        const nextCatalog = JSON.stringify({
            machines: config.machines.map(({ id, recipe, type, fuel }) => [id, recipe, type, fuel]),
            belts: config.belts.map(({ id, lanes }) => [id, lanes.map(lane => lane.ingredient)]),
            chests: config.chests?.map(chest => [chest.id, chest.type, chest.type === 'buffer-chest' ? chest.item_filter : [chest.remove_unfiltered_items ?? false, ...chest.item_filter.map(filter => [filter.item_name, filter.request_count > 0])]]),
        });
        if (catalog !== nextCatalog) { cached.clear(); catalog = nextCatalog; }
        const routes = new Map<number, unknown[]>();
        config.inserters.forEach((inserter, index) => {
            const route = [inserter.id ?? index + 1, inserter.source.type, inserter.source.id, inserter.sink.type, inserter.sink.id, inserter.filters,
                inserter.source.type === 'belt' ? inserter.source.pickup_merge : undefined];
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
    const issues = validateInserterCoverage(config);
    if (issues.length > 0) {
        throw new InserterCoverageError(issues);
    }
}
