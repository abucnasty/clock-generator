import { Entity, EntityId, ReadableEntityRegistry } from "../entities";
import { FACTORIO_MACHINE_STATE, FactorioMachineState } from "../state/factorio-entity-state";
import { MachineStatus } from "../state";
import { StockRecording } from "./machine-stock";
import { EndKind, RuleCountInserter, RuleCountMachine } from "./rule-count";

/** What the rule count reads of a run: its inserters with their ends, and its machines */
export interface RuleCountInput {
    inserters: RuleCountInserter[];
    machines: RuleCountMachine[];
}

function endKindOf(entity_id: EntityId): EndKind {
    if (EntityId.isMachine(entity_id)) {
        return "machine";
    }
    if (EntityId.isBelt(entity_id)) {
        return "belt";
    }
    if (EntityId.isChest(entity_id)) {
        return "chest";
    }
    return "other";
}

/**
 * The input of the rule count (`ruleCount`) for a simulated run: its stock, and the entities of its config, which
 * give the ends, their kinds and the recipes. The items of an inserter are the ones seen in its hand over the run, as
 * the series reads a dump and as a recording is read, so that the three sources group the same inserters alike.
 * An inserter is counted only if the stock has it; the machines carry `crafts_started`, the simulator's true starts.
 *
 * @param wired whether the run gives the inserter a circuit wire and an enable condition: for a clocked run, that
 *   the clock gives it windows; an unwired run has none
 */
export function ruleCountInputOfStock(
    stock: StockRecording,
    registry: ReadableEntityRegistry,
    wired: (inserter_id: string) => boolean,
): RuleCountInput {
    const recorded = new Set(stock.inserters.map(series => series.inserter_id));
    const inserters = new Map(stock.inserters.map(series => [series.inserter_id, series]));
    return {
        machines: stock.machines.map(machine => ({
            machine_id: machine.machine_id,
            recipe: machine.recipe,
            products_finished: machine.products_finished,
            working: machine.status.map(status => FACTORIO_MACHINE_STATE[status as MachineStatus] === FactorioMachineState.WORKING),
            crafts_started: machine.crafts_started,
            // a craft started in the tick: the simulator consumed its ingredients (it may start more than one)
            true_starts: machine.crafts_started.map((started, t) => t > 0 && started > machine.crafts_started[t - 1]),
        })),
        inserters: registry.getAll().filter(Entity.isInserter).filter(it => recorded.has(it.entity_id.id)).map(inserter => {
            const series = inserters.get(inserter.entity_id.id)!;
            const items = new Set(series.held_item.filter(item => item !== ""));
            const source = inserter.source.entity_id;
            const sink = inserter.sink.entity_id;
            return {
                inserter_id: inserter.entity_id.id,
                source_kind: endKindOf(source),
                sink_kind: endKindOf(sink),
                source_machine_id: EntityId.isMachine(source) ? source.id : null,
                sink_machine_id: EntityId.isMachine(sink) ? sink.id : null,
                items: [...items].sort(),
                wired: wired(inserter.entity_id.id),
                states: series.factorio_state,
                held: series.held,
            };
        }),
    };
}
