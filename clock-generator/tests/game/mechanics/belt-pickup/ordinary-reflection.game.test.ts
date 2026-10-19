import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {Config} from "../../../../src/config";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {BELT_SPEEDS, configAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {makeInputBeltBackedUp, useAccumulatorsOnBothLanes} from "./belt-pickup-fixtures";
import {ordinaryAtSpeed} from "./ordinary-speed-fixtures";
import {reflectOrdinaryPickup} from "./ordinary-reflection-fixtures";
import {compareContinuousSimulator} from "./ordinary-pickup-comparison";
import {assessSameItemPickups, SameItemPickupProbe} from "./same-item-pickup-probe";
import {JammedPickupReport, replayJammedPickups} from "./jammed-pickup-replay";

// These controls change the physical near side, not inserter mirroring. Both lanes supply accumulators.
for (const speed of BELT_SPEEDS) for (const geometry of ["straight-belt", "underground-entrance", "underground-exit"])
    for (const backed of [false, true]) {
        const name = `${speed.name}-${geometry}-${backed ? "backed" : "moving"}-reflected-same-item`;
        test(name, async context => {
            const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
            const replayRoot = process.env.BELT_SPEED_REFLECTED_REPLAY_DIR;
            context.skip(!replayRoot && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
            const capture = replayRoot ? {directory: path.resolve(replayRoot, name), cleanup() {}} : speedCapture(name);
            const fixture = GameFixturePaths.DIFFERENT_ITEMS;
            try {
                const config = await loadConfigFromFile(path.join(fixture, "config.json"));
                configAtSpeed(config, speed);
                config.overrides = {...config.overrides, backed_up_belts: backed};
                const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
                if (input.source.type !== "belt") throw new Error("Expected belt source");
                const length = geometry === "straight-belt" ? 1 : 0.5;
                input.source.pickup_length = length;
                input.source.pickup_layout = geometry === "straight-belt" ? "side-straight" : geometry === "underground-entrance" ? "side-entrance" : "side-exit";
                input.source.near_lane = 2;
                input.filters = ["accumulator"];
                config.belts.find(belt => belt.id === input.source.id)!.lanes.forEach(lane => {lane.ingredient = "accumulator";});
                let blueprint = useAccumulatorsOnBothLanes(fs.readFileSync(path.join(fixture, `${geometry}-scaffold.txt`), "utf8"));
                if (backed) blueprint = makeInputBeltBackedUp(blueprint);
                blueprint = reflectOrdinaryPickup(ordinaryAtSpeed(blueprint, speed));
                if (!replayRoot) {
                    fs.writeFileSync(path.join(capture.directory, "blueprint.txt"), blueprint + "\n");
                    fs.writeFileSync(path.join(capture.directory, "config.json"), JSON.stringify(config, null, 2) + "\n");
                    await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                        out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                        ticks: 1400, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 600},
                        settle_ticks: 0, seed: [], unclocked: true,
                        lua: composeProbeSource(path.join(fixture, "backed-up-probe.lua"), {item: "accumulator", gated: true,
                            reflected: true, speed: speed.units / 32, beltPrefix: speed.prefix}),
                        game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
                }
                const report = JSON.parse(fs.readFileSync(path.join(capture.directory,
                    "game/script-output/backed-up-pickups.json"), "utf8")) as SameItemPickupProbe & JammedPickupReport & {
                    belt: string; belt_speed: number; item: string;
                };
                const prototype = `${speed.prefix}${geometry === "straight-belt" ? "transport-belt" : "underground-belt"}`;
                expect(report).toMatchObject({item: "accumulator", belt: prototype, belt_speed: speed.units / 32, stack_size: 16,
                    endpoint: geometry === "straight-belt" ? "straight" : geometry === "underground-entrance" ? "input" : "output"});
                const recording = JSON.parse(fs.readFileSync(path.join(capture.directory, "recording.json"), "utf8")) as
                    {config: Config & {pickup_warnings?: unknown[]}};
                const exported = recording.config.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
                expect(exported.source).toMatchObject({near_lane: 2, pickup_length: length,
                    pickup_capture: {status: "supported", model: "belt", model_version: replayRoot ? 1 : 2, entity_name: prototype}});
                if (!replayRoot) expect(exported.source).toMatchObject({pickup_layout: input.source.pickup_layout});
                expect(recording.config.pickup_warnings).toBeUndefined();
                expect(report.samples).toHaveLength(1300);
                expect(report.samples.slice(0, 64).every(sample => sample.held === 0)).toBe(true);
                expect(report.samples.every(sample => sample.lanes.every(lane => lane.length === length))).toBe(true);
                expect(report.samples.filter(sample => sample.held > 0).every(sample => sample.held_item === "accumulator")).toBe(true);
                for (const lane of report.samples[63].lanes) {
                    const stacks = Object.values(lane.stacks);
                    expect(stacks).toHaveLength(length * 4);
                    expect(stacks.every(stack => stack.item === "accumulator" && stack.count === 4)).toBe(true);
                }
                // While the arm is gated, source phase must advance at the actual tier speed or stay jammed.
                const modulo = (position: number) => (position % 64 + 64) % 64;
                for (let lane = 0; lane < 2; lane++) for (let index = 57; index < 64; index++) {
                    const previous = Object.values(report.samples[index - 1].lanes[lane].stacks);
                    const current = Object.values(report.samples[index].lanes[lane].stacks);
                    expect(previous).toHaveLength(length * 4);
                    expect(current).toHaveLength(length * 4);
                    const phase = modulo(Math.round(current[0].at * 256));
                    const prior = modulo(Math.round(previous[0].at * 256));
                    expect(phase).toBe(backed ? prior : modulo(prior - speed.units * 8));
                }
                const moving = backed ? undefined : assessSameItemPickups(report, speed.units, 2, 65);
                const jammed = backed ? replayJammedPickups(report, 64, 2) : undefined;
                const quantityDifferences = compareContinuousSimulator(config, report, speed);
                const patterns = new Set<string>();
                let grabs: number[] = [], hands = 0;
                for (let index = 1; index < report.samples.length; index++) {
                    const previous = report.samples[index - 1], sample = report.samples[index];
                    if (!sample.held || !previous.held) grabs = [];
                    if (sample.held <= previous.held) continue;
                    grabs.push(sample.tick);
                    if (sample.held === 16) {
                        expect(grabs).toHaveLength(4);
                        patterns.add(grabs.map(tick => tick - grabs[0]).join(","));
                        hands++;
                    }
                }
                expect(hands).toBeGreaterThan(20);
                if (moving) expect(moving.hands).toBe(hands);
                if (jammed) {
                    expect(jammed.samples).toBe(1236);
                    expect(jammed.differences).toEqual([]);
                }
                const summary = {patterns: [...patterns].sort(), hands, quantity_difference_count: quantityDifferences.length,
                    quantity_first_difference: quantityDifferences[0] ?? null,
                    moving_replay_difference_count: moving?.differences.length ?? 0,
                    moving_replay_first_difference: moving?.differences[0] ?? null,
                    jammed_replay_difference_count: jammed?.differences.length ?? 0,
                    jammed_replay_first_difference: jammed?.differences[0] ?? null};
                fs.writeFileSync(path.join(capture.directory, "findings.json"), JSON.stringify(summary, null, 2) + "\n");
                if (process.env.BELT_SPEED_DISCOVERY !== "1") {
                    const baseline = JSON.parse(fs.readFileSync(path.join(fixture, "reflected-speed-expectations.json"), "utf8"));
                    expect(summary).toEqual(baseline[name]);
                }
            } finally {capture.cleanup();}
        }, 240_000);
    }
