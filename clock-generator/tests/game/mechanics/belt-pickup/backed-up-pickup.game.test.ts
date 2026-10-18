import { composeProbeSource } from "../../helpers/probe-source";
import { GameFixturePaths } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import { Config } from "../../../../src/config";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { SimulationContext } from "../../../../src/crafting/sequence/simulation-context";
import { InserterPickupMode } from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import { EntityState } from "../../../../src/state";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { makeInputBeltBackedUp } from "./belt-pickup-fixtures";

const SAMPLE = GameFixturePaths.DIFFERENT_ITEMS;
interface Stack { at: number; count: number; item: string; id: number }
interface Sample { tick: number; held: number; held_item?: string; lanes: { length: number; stacks: Stack[] | Record<string, never> }[] }
interface Probe { endpoint: string; item: string; samples: Sample[] }

function fullHands(samples: Sample[]): string[] {
    const hands: string[] = [];
    let grabs: number[] | null = null;
    for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1], current = samples[index];
        if (current.held === 0) grabs = null;
        if (current.held <= previous.held) continue;
        if (previous.held === 0) grabs = [];
        if (grabs === null) continue; // The recording can start in the middle of a hand.
        grabs.push(current.tick);
        if (current.held === 16) {
            const first = grabs[0];
            hands.push(grabs.map(tick => tick - first).join(","));
            grabs = null;
        }
    }
    return hands;
}

function simulatedHand(config: Config): string {
    const context = SimulationContext.fromConfig(config);
    const input = context.inserters.find(inserter => inserter.inserter_state.inserter.source.entity_id.type === "belt")!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected belt input");
    const mode = InserterPickupMode.create({
        inserterState: input, sourceState: source, tick_provider: context.tick_provider,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id),
    });
    const configured = config.inserters.find(inserter => inserter.source.type === "belt")!;
    expect(input.inserter.pickup_length).toBe(configured.source.type === "belt" ? configured.source.pickup_length : undefined);
    expect(input.inserter.belt_supply).toBe("backed_up");
    expect(source.pickup_lanes.size).toBe(0);
    const grabs: number[] = [];
    for (let tick = 0; tick < 20 && (input.held_item?.quantity ?? 0) < 16; tick++) {
        context.tick_provider.setCurrentTick(tick);
        const before = input.held_item?.quantity ?? 0;
        mode.executeForTick();
        if ((input.held_item?.quantity ?? 0) > before) grabs.push(tick);
    }
    expect(input.held_item?.quantity).toBe(16);
    return grabs.map(tick => tick - grabs[0]).join(",");
}

describe.sequential("backed-up pickup geometry", () => {
    for (const name of ["straight-belt", "underground-entrance", "underground-exit"]) {
        for (const item of ["accumulator", "supercapacitor"]) {
            test(`${name}, ${item}: backed-up stacks fill a hand in consecutive ticks`, async context => {
                const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
                context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
                const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "backed-up-pickup-"));
                try {
                    const config = await loadConfigFromFile(path.join(SAMPLE, "config.json"));
                    config.overrides = { ...config.overrides, backed_up_belts: true };
                    const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
                    if (input.source.type !== "belt") throw new Error("expected belt input");
                    const pickup_length = name === "straight-belt" ? 1 : 0.5;
                    input.source.pickup_length = pickup_length;
                    input.filters = [item];
                    const scaffold = fs.readFileSync(path.join(SAMPLE, `${name}-scaffold.txt`), "utf8");
                    const result = await recordInFactorio({
                        factorio: factorio!, save: save!, config, blueprint: makeInputBeltBackedUp(scaffold),
                        out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                        ticks: 1400, warmup_ticks: 3600, settle_ticks: 0, seed: [], unclocked: true,
                        lua: composeProbeSource(path.join(SAMPLE, "backed-up-probe.lua"), { item }),
                        game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
                    });
                    const recordedInput = result.recording.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
                    expect(recordedInput.source.pickup_length).toBe(input.source.pickup_length);
                    expect(recordedInput.stack_size).toBe(16);
                    const probe = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/backed-up-pickups.json"), "utf8")) as Probe;
                    expect(probe.endpoint).toBe(name === "straight-belt" ? "straight" : name === "underground-entrance" ? "input" : "output");
                    expect(probe.item).toBe(item);
                    expect(probe.samples).toHaveLength(1200);
                    expect(probe.samples.filter(sample => sample.held > 0).every(sample => sample.held_item === item)).toBe(true);
                    expect(probe.samples.every(sample => sample.lanes.every(lane => lane.length === pickup_length))).toBe(true);
                    // The lane not being collected must actually remain still, not stream past the pickup.
                    const idleLane = item === "accumulator" ? 1 : 0;
                    const snapshots = probe.samples.map(sample => JSON.stringify(sample.lanes[idleLane].stacks));
                    expect(new Set(snapshots).size).toBe(1);
                    expect(Array.isArray(probe.samples[0].lanes[idleLane].stacks)).toBe(true);
                    const hands = fullHands(probe.samples);
                    expect(hands.length).toBeGreaterThan(90);
                    expect(new Set(hands)).toEqual(new Set(["0,1,2,3"]));
                    expect(new Set(hands)).toEqual(new Set([simulatedHand(config)]));
                } finally {
                    fs.rmSync(scratch, { recursive: true, force: true });
                }
            }, 240_000);
        }
    }
});
