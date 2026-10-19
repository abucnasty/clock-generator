import {expect} from "vitest";
import {Config} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {InserterPickupMode} from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import {BeltPickupLane} from "../../../../src/state/belt-pickup-lane";
import {EntityState} from "../../../../src/state";
import {FixtureBeltSpeed} from "../../helpers/belt-speed-fixtures";
import {SameItemPickupProbe} from "./same-item-pickup-probe";

/** Initial full stock is observed while gated. Only arm arrival/drop times come from later samples. */
export function compareContinuousSimulator(config: Config, report: SameItemPickupProbe, speed: FixtureBeltSpeed) {
    const initial = report.samples.find(s => s.tick === 64)!;
    const context = SimulationContext.fromConfig(config);
    const input = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("Expected belt source");
    if (!config.overrides?.backed_up_belts) {
        source.pickup_lanes.set(input.entity_id.id, initial.lanes.map(lane => {
            const stacks = Object.values(lane.stacks);
            expect(stacks.length).toBe(initial.lanes[0].length * 4);
            const phase = ((Math.round(stacks[0].at * 32) + initial.tick * speed.units) % 8 + 8) % 8;
            return new BeltPickupLane(source.belt.belt_speed, input.inserter.pickup_length!, 4, phase);
        }));
    }
    const mode = InserterPickupMode.create({inserterState: input, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id), tick_provider: context.tick_provider});
    const differences: {tick: number; actual: number; predicted: number}[] = [];
    input.held_item = initial.held ? {item_name: initial.held_item!, quantity: initial.held} : null;
    let collecting = initial.held > 0;
    for (let index = 64; index < report.samples.length; index++) {
        const previous = report.samples[index - 1], sample = report.samples[index];
        context.tick_provider.setCurrentTick(sample.tick);
        if (sample.held < previous.held || sample.held === 0) {
            input.held_item = null;
            collecting = false;
        }
        if (sample.held > previous.held && previous.held === 0) collecting = true;
        if (!collecting) continue;
        mode.executeForTick();
        const predicted = input.held_item?.quantity ?? 0;
        if (predicted !== sample.held) differences.push({tick: sample.tick, actual: sample.held, predicted});
    }
    return differences;
}
