import { Entity, Machine, ReadableEntityRegistry } from "../entities";
import { FactorioDataService } from "../data";
import { StockRecording } from "./machine-stock";

/** What the inserters that take the same results out of a machine's result target took over a span of a run */
export interface ResultTakersOutcome {
    items: string[];
    /** The items by their game names, as a sentence has them ("holmium ore"); absent from results made before they were kept */
    item_labels?: string[];
    inserter_ids: string[];
    /** What the machine's crafts in the span gave of the items, on average */
    expected_items: number;
    /** What the inserters dropped in the span */
    taken_items: number;
    /**
     * They took less than the crafts gave by more than a period's worth and a hand each: what they leave grows, and the
     * container fills up in the end
     */
    short: boolean;
}

/** What was taken of a machine's results over a span of a run, and whether its container ever refused one */
export interface ResultsTaken {
    machine_id: string;
    /** Ticks of the span after which a result waited in the machine's own output: its container had no room for it */
    waiting_ticks: number;
    takers: ResultTakersOutcome[];
}

/**
 * The results of each machine that places its results into a container, over the ticks `from_tick` to the end of a run:
 * whether they all went into the container, and whether the inserters that take each out kept up with what the crafts
 * gave, within what a period gives and a hand each (a window takes a period's worth once a period, and a hand may wait
 * part full from one window to the next)
 */
export function resultsTakenOf(
    stock: StockRecording,
    registry: Pick<ReadableEntityRegistry, "getAll">,
    from_tick: number,
    period: number,
): ResultsTaken[] {
    const machines = registry.getAll().filter(Entity.isMachine).filter((machine): machine is Machine & { result_target: NonNullable<Machine["result_target"]> } =>
        machine.result_target !== undefined && machine.metadata.places_results === true);
    const inserters = registry.getAll().filter(Entity.isInserter);
    const held = new Map(stock.inserters.map(series => [series.inserter_id, series.held]));
    const dropped = (inserter_id: string) => {
        const series = held.get(inserter_id) ?? [];
        let sum = 0;
        for (let tick = Math.max(1, from_tick); tick < series.length; tick++) {
            if (series[tick] < series[tick - 1]) {
                sum += series[tick - 1] - series[tick];
            }
        }
        return sum;
    };
    return machines.flatMap(machine => {
        const series = stock.machines.find(it => it.machine_id === machine.entity_id.id);
        if (series === undefined || series.crafts_started.length <= from_tick) {
            return [];
        }
        const last = series.crafts_started.length - 1;
        const crafts = series.crafts_started[last] - series.crafts_started[Math.max(0, from_tick - 1)];
        const ticks = last + 1 - from_tick;
        let waiting_ticks = 0;
        for (let tick = from_tick; tick <= last; tick++) {
            if (Object.values(series.outputs).some(counts => counts[tick] > 0)) {
                waiting_ticks++;
            }
        }
        const takers = inserters.filter(inserter => inserter.source.entity_id.id === machine.result_target.id);
        const groups = new Map<string, { items: string[]; inserter_ids: string[]; hand: number }>();
        for (const taker of takers) {
            const items = machine.outputs.map(output => output.item_name).filter(item => taker.filtered_items.has(item));
            const key = items.join();
            const group = groups.get(key) ?? { items, inserter_ids: [], hand: taker.metadata.stack_size };
            group.inserter_ids.push(taker.entity_id.id);
            groups.set(key, group);
        }
        const outcomes = Array.from(groups.values()).map(group => {
            const per_craft = group.items.reduce((sum, item) => sum + machine.outputs.find(it => it.item_name === item)!.amount_per_craft.toDecimal(), 0);
            const expected_items = per_craft * crafts;
            const taken_items = group.inserter_ids.reduce((sum, id) => sum + dropped(id), 0);
            const per_period = ticks > 0 ? expected_items * period / ticks : 0;
            return {
                items: group.items, item_labels: group.items.map(item => FactorioDataService.itemNameInSentence(item)),
                inserter_ids: group.inserter_ids, expected_items, taken_items,
                short: taken_items < expected_items - per_period - group.inserter_ids.length * group.hand,
            };
        });
        return [{ machine_id: machine.entity_id.id, waiting_ticks, takers: outcomes }];
    });
}
