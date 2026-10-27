import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {loadConfigFromFile} from "../../../src/config/loader";
import {SimulationContext} from "../../../src/crafting/sequence/simulation-context";
import {InserterPickupMode} from "../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import {BeltPickupLane} from "../../../src/state/belt-pickup-lane";
import {EntityState} from "../../../src/state";
import {GameFixturePaths} from "./fixture-paths";
import {configAtSpeed, FixtureBeltSpeed} from "./belt-speed-fixtures";

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
        if (!backed) source.pickup_lanes.set(input.entity_id.id, source.belt.lanes.map(lane =>
            new BeltPickupLane(source.belt.belt_speed, input.inserter.pickup_length!, lane.stack_size, phase)));
        const mode = InserterPickupMode.create({inserterState: input, sourceState: source, tick_provider: context.tick_provider,
            sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id)});
        const grabs: number[] = [];
        for (let tick = 0; tick < 100 && (input.held_item?.quantity ?? 0) < handSize; tick++) {
            context.tick_provider.setCurrentTick(tick);
            const before = input.held_item?.quantity ?? 0;
            mode.executeForTick();
            if ((input.held_item?.quantity ?? 0) > before) grabs.push(tick);
        }
        expect(input.held_item?.quantity, "the hand fills").toBe(handSize);
        patterns.add(grabs.map(tick => tick - grabs[0]).join(","));
    }
    return patterns;
}

/**
 * What a recorded clock control states about itself, checked without the generator: the rate it was recorded at is the
 * period's share of the target, the game's baseline periods are all at that figure or the control says why not, and every
 * recovery was judged on enough periods.
 */
export function expectControlIsConsistent(native: {period: number; expected: number; baseline: number[];
    recovery: {recovered: number[]}[]}, pin: {period: number; expected: number}, targetItemsPerSecond: number) {
    expect(native.period, "the game was recorded on the pinned period").toBe(pin.period);
    expect(native.expected, "the pinned output per period is the target's share of it").toBe(pin.expected);
    expect(targetItemsPerSecond * native.period / 60, "output per period at the target rate").toBe(native.expected);
    expect(native.baseline.length).toBeGreaterThan(0);
    for (const loss of native.recovery) expect(loss.recovered.length).toBeGreaterThan(0);
}
