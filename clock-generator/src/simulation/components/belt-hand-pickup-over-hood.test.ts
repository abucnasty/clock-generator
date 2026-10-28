import fs from "fs";
import path from "path";
import {beforeAll, expect, test} from "vitest";
import {Config} from "../../config";
import {loadConfigFromFile} from "../../config/loader";
import {BELT_SPEEDS, configAtSpeed} from "../../../tests/game/helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../../tests/game/helpers/fixture-paths";
import {compareContinuousSimulator} from "../../../tests/game/mechanics/belt-pickup/ordinary-pickup-comparison";

interface Clip {
    name: string; belt_speed: number; near_lane: 1 | 2; backed: boolean; recipe: string; crafting_speed: number;
    item: string; lane_items: string[]; frames: [held: number, lane1: [number, number][], lane2: [number, number][]][];
}
const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT,
    "pickup-clips.json"), "utf8")) as {seed_tick: number; clips: Clip[]};
let base: Config;
beforeAll(async () => {base = await loadConfigFromFile(path.join(GameFixturePaths.FRONT_UNDERGROUND_EXIT, "config.json"));});

// Initial full stock and native first arrival are supplied. Later item, quantity and stock are predicted;
// these clips do not establish absolute arm arrival or generated-clock throughput.
for (const clip of fixture.clips) test(`production over-the-hood pickup matches native clip: ${clip.name}`, () => {
    const config = structuredClone(base);
    const speed = BELT_SPEEDS.find(speed => speed.units / 32 === clip.belt_speed)!;
    configAtSpeed(config, speed);
    config.overrides = {...config.overrides, backed_up_belts: clip.backed};
    config.target_output.recipe = clip.recipe;
    config.machines[0] = {...config.machines[0], recipe: clip.recipe, crafting_speed: clip.crafting_speed, productivity: 0};
    config.belts.find(belt => belt.id === 1)!.lanes[0].ingredient = clip.recipe;
    const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
    if (input.source.type !== "belt") throw Error("Expected belt");
    input.source.pickup_layout = "over-hood-exit";
    input.source.near_lane = clip.near_lane;
    input.source.pickup_capture = {status: "supported", model: "belt", model_version: 2, entity_type: "underground-belt"};
    config.belts.find(belt => belt.id === input.source.id)!.lanes.forEach((lane, index) => {lane.ingredient = clip.lane_items[index];});
    const report = {endpoint: "output", stack_size: 16, samples: clip.frames.map(([held, ...lanes], index) => ({
        tick: fixture.seed_tick + index, held, held_item: held ? clip.item : undefined,
        lanes: lanes.map((stock, lane) => ({length: 0.5,
            stacks: stock.map(([position, count]) => ({at: position / 256, count, item: clip.lane_items[lane]}))})),
    }))};
    expect(compareContinuousSimulator(config, report, speed)).toEqual([]);
});
