import {Config} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {EntityState} from "../../../../src/state";
import {SideFedPickupLane} from "../../../../src/state/side-fed-pickup-lane";
import {InserterPickupMode} from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";

export interface SingleSideClip {
    name: string; speed: "turbo" | "express" | "fast" | "yellow"; origin: "outer" | "inner";
    frames: [held: number, enabled: boolean, stock: [number, number][], incoming: [number, number][]][];
}

/** Native arm starts and drops are boundaries; held counts and both transport queues are predicted between them. */
export function compareSingleSideFeed(base: Config, clip: SingleSideClip, replaceControls = false) {
    const config = structuredClone(base);
    config.overrides = {...config.overrides, backed_up_belts: true};
    config.belts[0].type = `${clip.speed === "yellow" ? "" : clip.speed + "-"}transport-belt` as typeof config.belts[0]["type"];
    const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
    if (input.source.type !== "belt") throw Error("Expected belt input");
    input.source.pickup_supply = ["through", clip.origin === "inner" ? "side-inner" : "side-outer"];
    const context = SimulationContext.fromConfig(config), state = context.inserters.find(inserter => inserter.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    const sink = context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id);
    if (!EntityState.isBelt(source)) throw Error("Expected belt");
    const createMode = () => InserterPickupMode.create({inserterState: state, sourceState: source, sinkState: sink,
        tick_provider: context.tick_provider});
    let mode = createMode(), active = false;
    const lane = source.pickup_lanes.get(state.entity_id.id)![1];
    if (!(lane instanceof SideFedPickupLane)) throw Error("Expected side-fed queue");
    const differences: {tick: number; field: string; expected: unknown; actual: unknown}[] = [];
    const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) differences.push({tick, field, expected, actual});
    };
    for (const [index, [held, enabled, stock, incoming]] of clip.frames.entries()) {
        const tick = index + 1;
        context.tick_provider.setCurrentTick(tick);
        if (replaceControls && index % 7 === 0) mode = createMode();
        if (held === 0) {state.held_item = null; active = false;}
        else if (clip.frames[index - 1]?.[0] === 0) active = true;
        if (active && (state.held_item?.quantity ?? 0) < 16 && enabled) mode.executeForTick();
        check(tick, "held", state.held_item?.quantity ?? 0, held);
        check(tick, "stock", lane.snapshot(tick), stock);
        check(tick, "incoming", lane.traffic.snapshot()[clip.origin].map(stack => [stack.position, stack.count]), incoming);
        sink.inventoryState.clear();
    }
    return differences;
}
