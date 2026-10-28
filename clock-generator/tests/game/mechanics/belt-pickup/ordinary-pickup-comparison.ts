import {expect} from "vitest";
import {Config} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {bindHandPorts} from "../../../../src/simulation/components/hand-ports";
import {BeltPickupLane} from "../../../../src/state/belt-pickup-lane";
import {EntityState} from "../../../../src/state";
import {FixtureBeltSpeed} from "../../helpers/belt-speed-fixtures";
import {SameItemPickupProbe} from "./same-item-pickup-probe";

/** Initial full stock is observed while gated. Only arm arrival/drop times come from later samples. */
export function compareContinuousSimulator(config: Config, report: SameItemPickupProbe, speed: FixtureBeltSpeed) {
    const seedIndex = report.samples.findIndex(sample => sample.tick === 64);
    if (seedIndex < 0 || report.samples[seedIndex].held !== 0) throw new Error("Pickup comparison needs an empty-hand closed-gate seed at tick 64");
    const initial = report.samples[seedIndex];
    const context = SimulationContext.fromConfig(config);
    const input = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("Expected belt source");
    if (!config.overrides?.backed_up_belts) {
        source.seedPickups(input.entity_id.id, initial.lanes.map(lane => {
            const stacks = Object.values(lane.stacks);
            expect(stacks.length).toBe(initial.lanes[0].length * 4);
            const phase = ((Math.round(stacks[0].at * 32) + initial.tick * speed.units) % 8 + 8) % 8;
            return new BeltPickupLane(source.belt.belt_speed, input.inserter.pickup_length!, 4, phase);
        }));
    }
    const pickup = bindHandPorts({inserterState: input, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id), tick_provider: context.tick_provider}).pickup;
    const differences: {tick: number; actual: number; predicted: number; actual_item?: string; predicted_item?: string; lane_mismatches?: number}[] = [];
    input.held_item = initial.held ? {item_name: initial.held_item!, quantity: initial.held} : null;
    let collecting = initial.held > 0;
    for (let index = seedIndex + 1; index < report.samples.length; index++) {
        const previous = report.samples[index - 1], sample = report.samples[index];
        if (sample.tick !== previous.tick + 1) throw new Error("Pickup comparison needs consecutive native samples");
        context.tick_provider.setCurrentTick(sample.tick);
        if (sample.held < previous.held || sample.held === 0) {
            input.held_item = null;
            collecting = false;
        }
        if (sample.held > previous.held && previous.held === 0) collecting = true;
        if (!collecting) continue;
        pickup.pickup();
        const predicted = input.held_item?.quantity ?? 0;
        let lane_mismatches = 0;
        const lanes = source.pickupsOf(input.entity_id.id)!;
        for (const [index, lane] of sample.lanes.entries()) {
            const actual = Object.values(lane.stacks).map(stack => [Math.round(stack.at * 256), stack.count, stack.item]);
            const expected = lanes[index].snapshot(sample.tick).map(([position, count]) => [position, count, source.belt.lanes[index].ingredient_name]);
            if (JSON.stringify(actual) !== JSON.stringify(expected)) lane_mismatches++;
        }
        const wrong_item = input.held_item?.item_name !== sample.held_item;
        if (predicted !== sample.held || wrong_item || lane_mismatches) differences.push({tick: sample.tick, actual: sample.held, predicted,
            ...(wrong_item && {actual_item: sample.held_item, predicted_item: input.held_item?.item_name}),
            ...(lane_mismatches > 0 && {lane_mismatches})});
    }
    return differences;
}
