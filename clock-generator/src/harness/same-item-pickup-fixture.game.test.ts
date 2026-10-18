import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { describe, expect, test } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { matchRecordingToConfig } from "../verification/entity-matching";
import { recordInFactorio } from "./factorio-harness";
import { encodeBlueprintFile } from "../blueprints/serde";
import { FactorioBlueprintFile } from "../blueprints/blueprint";
import { assessSameItemPickups, SameItemPickupProbe } from "./same-item-pickup-probe";
import { Config } from "../config";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { InserterPickupMode } from "../control-logic/inserter/modes/pickup/pickup-mode";

const SAMPLE = path.dirname(ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM);

/** The real simulator's unrestricted hand, compared below with every complete measured hand of this fixture. */
function simulatedHand(config: Config): string {
    const context = SimulationContext.fromConfig(config);
    const state = context.inserters.find(inserter => inserter.entity_id.number === 2)!.inserter_state;
    const mode = InserterPickupMode.create({
        inserterState: state, tick_provider: context.tick_provider,
        sourceState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id),
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
    });
    const grabs: number[] = [];
    let previous = 0;
    for (let tick = 0; tick < 100 && previous < 16; tick++) {
        context.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        const held = state.held_item?.quantity ?? 0;
        if (held > previous) grabs.push(tick);
        previous = held;
    }
    return grabs.map(tick => tick - grabs[0]).join(",");
}

// Compare actual simulator grabs and the independently seeded lane-position replay against the game.
describe.sequential("same-item moving pickup fixtures", () => {
    for (const speed of ["turbo", "express"] as const) for (const nearLane of [1, 2] as const) {
        for (const name of ["straight-belt", "underground-entrance", "underground-exit"]) {
            test(`${speed} ${name}, near lane ${nearLane}: reachable-stack rule predicts both lanes`, async context => {
                const factorio = process.env.FACTORIO_PATH;
                const save = process.env.FACTORIO_HARNESS_SAVE;
                context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
                const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "same-item-pickup-"));
                try {
                    const config = await loadConfigFromFile(name === "straight-belt"
                        ? ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM_STRAIGHT : ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM);
                    config.belts[0].type = speed === "turbo" ? "turbo-transport-belt" : "express-transport-belt";
                    const source = config.inserters[1].source;
                    if (source.type !== "belt") throw new Error("fixture input must pick up from a belt");
                    source.near_lane = nearLane;
                    const text = fs.readFileSync(path.join(SAMPLE, `${name}-scaffold.txt`), "utf8").trim();
                    const blueprint = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString()) as FactorioBlueprintFile;
                    for (const entity of blueprint.blueprint!.entities!) {
                        entity.name = entity.name.replace("turbo-", `${speed}-`) as typeof entity.name;
                        if (nearLane === 2) {
                            entity.position = { ...entity.position, y: 1 - entity.position.y };
                            if (!entity.direction) entity.direction = 8;
                            else if (entity.direction === 8) entity.direction = 0;
                        }
                    }
                    const result = await recordInFactorio({
                        factorio: factorio!, save: save!, config,
                        blueprint: encodeBlueprintFile(blueprint),
                        out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                        ticks: 1260, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
                        lua: fs.readFileSync(path.join(SAMPLE, "probe.lua"), "utf8"),
                        game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
                    });
                    const match = matchRecordingToConfig(result.recording, config);
                    expect(match.unmatched_config_machines).toEqual([]);
                    expect(match.unmatched_config_inserters).toEqual([]);
                    const input = result.recording.inserters.find(inserter => match.inserters.get(inserter.id) === 2)!;
                    expect(input.source.pickup_length).toBe(name === "straight-belt" ? 1 : 0.5);
                    expect(input.source.near_lane).toBe(nearLane);
                    expect(input.stack_size).toBe(16);
                    const belt = result.recording.config.belts.find(belt => belt.id === input.source.id)!;
                    expect(belt.lanes.map(lane => ({ ingredient: lane.ingredient, stack_size: lane.stack_size })))
                        .toEqual(config.belts[0].lanes);
                    expect(result.recording.config.machines).toEqual(expect.arrayContaining([expect.objectContaining(config.machines[0])]));
                    const probe = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/same-item-pickups.json"), "utf8")) as SameItemPickupProbe;
                    expect(probe.endpoint).toBe(name === "straight-belt" ? "straight" : name === "underground-entrance" ? "input" : "output");
                    expect(probe.samples).toHaveLength(1200);
                    const settled = probe.samples.slice(60);
                    expect(new Set(settled.map(sample => sample.held))).toEqual(new Set([0, 4, 8, 12, 16]));
                    for (const index of [0, 1]) {
                        expect(settled.every(sample => sample.lanes[index].length === input.source.pickup_length)).toBe(true);
                        // Factorio serializes an empty Lua array as {}; an empty lane is an expected observation.
                        const stacks = settled.flatMap(sample => Array.isArray(sample.lanes[index].stacks) ? sample.lanes[index].stacks : []);
                        expect(stacks.length).toBeGreaterThan(100);
                        expect(stacks.every(stack => stack.item === "iron-plate" && stack.count === 4)).toBe(true);
                    }
                    const assessment = assessSameItemPickups(probe, speed === "turbo" ? 4 : 3, nearLane);
                    expect(assessment.hands).toBeGreaterThan(90);
                    expect(assessment.differences).toEqual([]);
                    expect(assessment.hand_patterns).toEqual(new Set([simulatedHand(config)]));
                    if (name !== "straight-belt") {
                        expect(assessment.far_grabs).toBeGreaterThan(0);
                        expect(assessment.legacy_missed_hands).toBeGreaterThan(0);
                    }
                } finally {
                    fs.rmSync(scratch, { recursive: true, force: true });
                }
            }, 240_000);
        }
    }
});
