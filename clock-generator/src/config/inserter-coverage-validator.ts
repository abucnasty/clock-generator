import { Config, BeltConfig, ChestConfig, InserterConfig, MachineConfiguration } from './schema';
import { FactorioDataService } from '../data/factorio-data-service';
import { InserterCoverageError, InserterCoverageIssue, InserterFixOption } from './errors';

// ============================================================================
// Item-source coverage helpers
// ============================================================================

function beltCoversItem(belt: BeltConfig, itemName: string): boolean {
    return belt.lanes.some((lane) => lane.ingredient === itemName);
}

function chestCoversItem(chest: ChestConfig, itemName: string): boolean {
    if (chest.type === 'buffer-chest') {
        return chest.item_filter === itemName;
    }
    // infinity-chest
    return chest.item_filter.some((f) => f.item_name === itemName);
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
        return belt !== undefined && beltCoversItem(belt, itemName);
    }
    if (source.type === 'chest') {
        const chest = chests.find((c) => c.id === source.id);
        return chest !== undefined && chestCoversItem(chest, itemName);
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

/** Returns true if this inserter carries `itemName` out of machine `machineId`. */
function inserterCoversOutputItem(
    inserter: InserterConfig,
    machineId: number,
    itemName: string,
): boolean {
    if (inserter.source.type !== 'machine' || inserter.source.id !== machineId) {
        return false;
    }
    if (inserter.filters && inserter.filters.length > 0 && !inserter.filters.includes(itemName)) {
        return false;
    }
    return true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validates that every machine ingredient and output item in the config has at
 * least one inserter covering it.
 *
 * Each missing ingredient/output produces a separate `InserterCoverageIssue`
 * — the loop never returns early so ALL missing items are reported.
 *
 * Returns an empty array if `FactorioDataService` has not been initialized yet,
 * so this is safe to call from the browser before data is loaded.
 */
export function validateInserterCoverage(config: Config): InserterCoverageIssue[] {
    if (!FactorioDataService.isInitialized()) {
        return [];
    }

    const issues: InserterCoverageIssue[] = [];
    const belts = config.belts;
    const chests = config.chests ?? [];
    const machines = config.machines;

    for (const machine of config.machines) {
        let recipe;
        try {
            recipe = FactorioDataService.findRecipeOrThrow(machine.recipe);
        } catch {
            // Recipe not found in data — skip this machine
            continue;
        }

        // ── Input ingredients ────────────────────────────────────────────────
        for (const ingredient of recipe.ingredients) {
            const itemName = ingredient.name;
            const covered = config.inserters.some((ins) =>
                inserterCoversInputItem(ins, machine.id, itemName, belts, chests, machines),
            );

            if (!covered) {
                const fixOptions: InserterFixOption[] = [];

                // Highest-priority fix: if another machine in the config
                // already produces this ingredient, prefer a machine→machine inserter.
                for (const other of config.machines) {
                    if (other.id === machine.id) continue;
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
                            ins.sink.id === machine.id,
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
                    fix_options: fixOptions,
                });
            }
        }

        // ── Output results ───────────────────────────────────────────────────
        for (const result of recipe.results) {
            const itemName = result.name;
            const covered = config.inserters.some((ins) =>
                inserterCoversOutputItem(ins, machine.id, itemName),
            );

            if (!covered) {
                issues.push({
                    kind: 'missing_output_inserter',
                    machine_id: machine.id,
                    recipe: machine.recipe,
                    item_name: itemName,
                    fix_options: [
                        { type: 'new_belt', item_name: itemName },
                        { type: 'infinity_chest', item_name: itemName },
                    ],
                });
            }
        }
    }

    return issues;
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
