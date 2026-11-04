import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {loadConfigFromFile} from "../../../src/config/loader";
import {SimulationContext} from "../../../src/crafting/sequence/simulation-context";
import {bindHandPorts} from "../../../src/simulation/components/hand-ports";
import {BeltPickupLane} from "../../../src/state/belt-pickup-lane";
import {EntityState} from "../../../src/state";
import {GameFixturePaths} from "./fixture-paths";
import {configAtSpeed, FixtureBeltSpeed} from "./belt-speed-fixtures";
import {ContainerStorage} from "../../../src/simulation/components/container-storage";
import { TickByHand } from "../../../src/crafting/runner/tick-by-hand.fixture";
import {NativeRunSummary, runHolds} from "../builds/clock-controls";

/**
 * Helpers for the unit tests of the fixture families: the documented mechanic of a family, run in the simulator on the
 * family's fixture config and compared with the figures recorded in the game. No generation search, no Factorio. The
 * pattern for a family is in the fixture-units TEMPLATE; the first user is belt-pickup-clock-mechanics.test.ts.
 */

export type PickupGeometry = "straight-belt" | "underground-entrance" | "underground-exit";
export const PICKUP_GEOMETRIES: readonly PickupGeometry[] = ["straight-belt", "underground-entrance", "underground-exit"];
export type PickupIngredient = "accumulator" | "supercapacitor" | "same-item";
export const PICKUP_INGREDIENTS: readonly PickupIngredient[] = ["accumulator", "supercapacitor", "same-item"];

/** The recorded figures of a fixture folder (`speed-expectations.json`, `phase-expectations.json`, ...), by case name */
export function readFixtureFigures<T>(fixtureDir: string, file: string): Record<string, T> {
    return JSON.parse(fs.readFileSync(path.join(fixtureDir, file), "utf8"));
}

/**
 * The different-items side pickup fixture at one belt tier, geometry and supply, taking only `ingredient` (for
 * `same-item`: both lanes carry the accumulator). The config the belt speed coverage game test records in the game.
 */
export async function sidePickupConfig(speed: FixtureBeltSpeed, geometry: PickupGeometry, backed: boolean,
    ingredient: PickupIngredient): Promise<Config> {
    const config = await loadConfigFromFile(path.join(GameFixturePaths.DIFFERENT_ITEMS, "config.json"));
    configAtSpeed(config, speed);
    config.overrides = {...config.overrides, backed_up_belts: backed};
    const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
    if (input.source.type !== "belt") throw new Error("expected a belt input");
    input.source.pickup_length = geometry === "straight-belt" ? 1 : 0.5;
    input.source.pickup_layout = geometry === "straight-belt" ? "side-straight" : geometry === "underground-entrance" ? "side-entrance" : "side-exit";
    const wanted = ingredient === "same-item" ? "accumulator" : ingredient;
    input.filters = [wanted];
    if (ingredient === "same-item") config.belts.find(belt => belt.id === input.source.id)!.lanes.forEach(lane => {lane.ingredient = wanted;});
    return config;
}

/**
 * The ticks, counted from the first, on which the belt-fed input inserter takes stacks until its hand is full, as
 * `"0,1,2,3"`: one pattern per starting lane phase of a moving belt (the eight the game starts a pickup tile in), one
 * for a backed-up belt. The simulator's answer to the "patterns" the game records per case.
 */
export function firstHandPatterns(config: Config, handSize = 16): Set<string> {
    const patterns = new Set<string>();
    const backed = config.overrides?.backed_up_belts === true;
    for (let phase = 0; phase < (backed ? 1 : 8); phase++) {
        const context = SimulationContext.fromConfig(config);
        const input = context.inserters.find(inserter => inserter.inserter_state.inserter.source.entity_id.type === "belt")!.inserter_state;
        const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
        if (!EntityState.isBelt(source)) throw new Error("expected a belt input");
        if (!backed) source.seedPickups(input.entity_id.id, source.belt.lanes.map(lane =>
            new BeltPickupLane(source.belt.belt_speed, input.inserter.pickup_length!, lane.stack_size, phase)));
        const pickup = bindHandPorts({inserterState: input, sourceState: source, tick_provider: context.tick_provider,
            sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id)}).pickup;
        const grabs: number[] = [];
        for (let tick = 0; tick < 100 && (input.held_item?.quantity ?? 0) < handSize; tick++) {
            context.tick_provider.setCurrentTick(tick);
            const before = input.held_item?.quantity ?? 0;
            pickup.pickup();
            if ((input.held_item?.quantity ?? 0) > before) grabs.push(tick);
        }
        expect(input.held_item?.quantity, "the hand fills").toBe(handSize);
        patterns.add(grabs.map(tick => tick - grabs[0]).join(","));
    }
    return patterns;
}

/** The protocol's bounds (pickup-clock-capture.ts RUN_PROTOCOL): a minute's window, a baseline of 1 to 10 minutes, a run of at most 15 */
const RUN_BOUNDS = {window: 3600, baseline: 3600, maxBaseline: 36_000, cap: 54_000};

/**
 * What a run under the protocol timed in game ticks states about itself, checked without the game: it ran the pinned clock
 * at the target's share, over the protocol's window, and its steps follow each other within the bounds: steady state, the
 * baseline after it, each disturbance after the step before it, released when the output fell and recovered after that.
 */
export function expectRunIsConsistent(native: NativeRunSummary, pin: {period: number; expected: number}, targetItemsPerSecond: number) {
    expect(native.protocol).toBe("trailing-minute");
    expect(native.period, "the game was recorded on the pinned period").toBe(pin.period);
    expect(native.target, "the target's share the build is asked for").toBe(targetItemsPerSecond);
    // the run keeps its target to a millionth (34.285714 for 240/7): its output a period is the pin's to a thousandth
    expect(Math.round(native.target * native.period / 60 * 1e3) / 1e3, "the pinned output per period is the target's").toBe(Math.round(pin.expected * 1e3) / 1e3);
    expect(native.window).toBe(RUN_BOUNDS.window);
    expect(native.expected, "the window holds the target rate over it").toBe(Math.round(native.target * native.window / 60 * 1e6) / 1e6);
    expect(native.ended).toBeLessThanOrEqual(RUN_BOUNDS.cap);
    if (native.steady === null) return;
    expect(native.steady).toBeGreaterThanOrEqual(native.window);
    const baseline = native.baseline;
    if (!baseline) return;
    expect(baseline.ticks).toBeGreaterThanOrEqual(RUN_BOUNDS.baseline);
    expect(baseline.ticks).toBeLessThanOrEqual(RUN_BOUNDS.maxBaseline);
    expect(baseline.expected).toBe(native.expected * baseline.ticks / native.window);
    expect(baseline.min).toBeLessThanOrEqual(baseline.max);
    expect(baseline.held, "held: the trailing window never fell below the target in the baseline").toBe(baseline.min >= native.expected);
    let after = native.steady + baseline.ticks;
    for (const disturbance of native.disturbances) {
        expect(disturbance.start, `${disturbance.kind}: starts after the step before it`).toBe(after);
        if (disturbance.drop !== undefined) expect(disturbance.release, `${disturbance.kind}: released when the output fell`).toBe(disturbance.drop);
        if (disturbance.recovered === undefined) break;
        expect(disturbance.recovered).toBeGreaterThan(disturbance.release!);
        after = disturbance.recovered;
    }
}

/**
 * What a run says of the selection it was recorded on, as each family's generation test checks it: a clock the generator calls
 * stable holds its target and recovers from every disturbance in the game; a run under the selection's own supply that misses
 * the target over its baseline has the generator's own holds verdict false.
 */
export function expectRunAgreesWithSelection(name: string, native: NativeRunSummary, selected: {verdict: string; holds: boolean},
    recordedUnderOwnSupply = true) {
    const drained = native.stock && !native.stock.holds ? `; output stock ${native.stock.end} at the end, below the baseline's lowest ${native.stock.lowest}` : "";
    if (selected.verdict === "stable") expect(runHolds(native), `${name}: a stable clock holds and recovers in the game (${native.result}${drained})`).toBe(true);
    if (recordedUnderOwnSupply && native.baseline?.meets !== true) {
        expect(selected.holds, `${name}: the run misses the target over its baseline: the generator has to see that itself`).toBe(false);
    }
}

/**
 * A car, tank or cargo wagon between its supplies and a machine, run in the simulator with no clock: the supplies fill
 * the container as far as its slots allow. Returns the container's slot count and, for each item, the most of it the
 * container held in the run and the most its slots may hold (`getCapacity`). A run long enough has the two equal: the
 * stock a cut of that item has to use up (the cut length of the container clock family is sized by it).
 */
export function unclockedContainerStock(config: Config, items: string[], ticks = 15_000): {
    slots: number; peak: Record<string, number>; capacity: Record<string, number>;
} {
    const context = SimulationContext.fromConfig(config);
    const container = context.state_registry.getAllStates().find(ContainerStorage.isSlots);
    if (!container) throw new Error("expected a slot container");
    const tick = new TickByHand(context);
    const peak = Object.fromEntries(items.map(item => [item, 0]));
    for (let i = 0; i < ticks; i++) {
        tick.executeForTick();
        for (const item of items) peak[item] = Math.max(peak[item], container.getCurrentQuantity(item));
    }
    return {slots: container.chest.slot_count, peak, capacity: Object.fromEntries(items.map(item => [item, container.chest.getCapacity(item)]))};
}
