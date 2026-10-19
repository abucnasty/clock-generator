import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {Config} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {InserterPickupMode} from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import {BeltPickupLane} from "../../../../src/state/belt-pickup-lane";
import {EntityState} from "../../../../src/state";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {BELT_SPEEDS, configAtSpeed, speedCapture, FixtureBeltSpeed} from "../../helpers/belt-speed-fixtures";
import {ordinaryAtSpeed} from "./ordinary-speed-fixtures";
import {makeInputBeltBackedUp, useAccumulatorsOnBothLanes} from "./belt-pickup-fixtures";
import {assessSameItemPickups, SameItemPickupProbe} from "./same-item-pickup-probe";

/** Initial full stock is observed while gated. Only arm arrival/drop times come from later samples. */
function compareContinuousSimulator(config: Config, report: SameItemPickupProbe, speed: FixtureBeltSpeed) {
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

/** Compare hand collection, allowing the explicitly uncalibrated initial lane phases. */
function simulatorPatterns(config: Config) {
    const patterns = new Set<string>();
    const backed = config.overrides?.backed_up_belts;
    for (let phase = 0; phase < (backed ? 1 : 8); phase++) {
        const context = SimulationContext.fromConfig(config);
        const input = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
        const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
        if (!EntityState.isBelt(source)) throw new Error("Expected input belt");
        if (!backed) source.pickup_lanes.set(input.entity_id.id, source.belt.lanes.map(lane =>
            new BeltPickupLane(source.belt.belt_speed, input.inserter.pickup_length!, lane.stack_size, phase)));
        const mode = InserterPickupMode.create({inserterState: input, sourceState: source,
            sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id), tick_provider: context.tick_provider});
        const grabs: number[] = [];
        for (let tick = 0; tick < 100 && (input.held_item?.quantity ?? 0) < 16; tick++) {
            context.tick_provider.setCurrentTick(tick);
            const before = input.held_item?.quantity ?? 0;
            mode.executeForTick();
            if ((input.held_item?.quantity ?? 0) > before) grabs.push(tick);
        }
        expect(input.held_item?.quantity).toBe(16);
        patterns.add(grabs.map(tick => tick - grabs[0]).join(","));
    }
    return patterns;
}

for (const speed of BELT_SPEEDS) for (const geometry of ["straight-belt", "underground-entrance", "underground-exit"])
    for (const backed of [false, true]) for (const ingredient of ["accumulator", "supercapacitor", "same-item"] as const) {
        const name = `${speed.name}-${geometry}-${backed ? "backed" : "moving"}-${ingredient}`;
        test(name, async context => {
            const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
            const replayRoot = process.env.BELT_SPEED_REPLAY_DIR;
            context.skip(!replayRoot && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
            const capture = replayRoot ? {directory: path.resolve(replayRoot, name), cleanup() {}} : speedCapture(name);
            const fixture = GameFixturePaths.DIFFERENT_ITEMS;
            try {
                const config = await loadConfigFromFile(path.join(fixture, "config.json"));
                configAtSpeed(config, speed);
                config.overrides = {...config.overrides, backed_up_belts: backed};
                const input = config.inserters.find(i => i.source.type === "belt")!;
                if (input.source.type !== "belt") throw new Error("Expected belt source");
                const length = geometry === "straight-belt" ? 1 : 0.5;
                input.source.pickup_length = length;
                const wanted = ingredient === "same-item" ? "accumulator" : ingredient;
                input.filters = [wanted];
                let blueprint = fs.readFileSync(path.join(fixture, `${geometry}-scaffold.txt`), "utf8");
                if (ingredient === "same-item") {
                    blueprint = useAccumulatorsOnBothLanes(blueprint);
                    config.belts.find(b => b.id === input.source.id)!.lanes.forEach(lane => {lane.ingredient = wanted;});
                }
                if (backed) blueprint = makeInputBeltBackedUp(blueprint);
                blueprint = ordinaryAtSpeed(blueprint, speed);
                if (!replayRoot) {
                    fs.writeFileSync(path.join(capture.directory, "blueprint.txt"), blueprint + "\n");
                    fs.writeFileSync(path.join(capture.directory, "config.json"), JSON.stringify(config, null, 2) + "\n");
                    await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                    out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                    ticks: 1400, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 600},
                    settle_ticks: 0, seed: [], unclocked: true,
                    lua: composeProbeSource(path.join(fixture, "backed-up-probe.lua"), {item: wanted, gated: true}),
                    game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
                }
                const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/backed-up-pickups.json"), "utf8")) as
                    SameItemPickupProbe & {belt: string; belt_speed: number; item: string};
                expect(report.belt_speed).toBe(speed.units / 32);
                const recording = JSON.parse(fs.readFileSync(path.join(capture.directory, "recording.json"), "utf8")) as
                    {config: Config & {pickup_warnings?: unknown[]}};
                const exported = recording.config.inserters.find(i => i.source.type === "belt" && i.sink.type === "machine")!;
                expect(exported.source).toMatchObject({pickup_length: length, near_lane: 1,
                    pickup_capture: {status: "supported", model: "belt", model_version: 1,
                        entity_name: `${speed.prefix}${geometry === "straight-belt" ? "transport-belt" : "underground-belt"}`}});
                expect(recording.config.pickup_warnings).toBeUndefined();
                expect(report.item).toBe(wanted);
                expect(report.samples).toHaveLength(1300);
                expect(report.samples.slice(0, 64).every(s => s.held === 0)).toBe(true);
                expect(report.samples.every(s => s.lanes.every(l => l.length === length))).toBe(true);
                expect(report.samples.filter(s => s.held > 0).every(s => s.held_item === wanted)).toBe(true);
                expect(report.samples[63].lanes.every(lane => Object.values(lane.stacks).length === length * 4)).toBe(true);
                if (ingredient !== "same-item") {
                    const other = ingredient === "accumulator" ? 1 : 0;
                    const snapshots = new Set(report.samples.slice(63).map(s => JSON.stringify(s.lanes[other].stacks)));
                    expect(snapshots.size === 1).toBe(backed);
                }
                const matchingLane = ingredient === "same-item" ? undefined : ingredient === "accumulator" ? 1 : 2;
                const assessment = backed ? undefined : assessSameItemPickups(report, speed.units, 1, 65, matchingLane);
                if (assessment) {
                    expect(assessment.hands).toBeGreaterThan(20);
                }
                const patterns = new Set<string>();
                let grabs: number[] = [];
                let completedHands = 0;
                for (let index = 1; index < report.samples.length; index++) {
                    const previous = report.samples[index - 1], sample = report.samples[index];
                    if (sample.held === 0) grabs = [];
                    if (sample.held <= previous.held) continue;
                    if (previous.held === 0) grabs = [];
                    grabs.push(sample.tick);
                    if (sample.held === 16 && grabs.length === 4) {
                        patterns.add(grabs.map(t => t - grabs[0]).join(","));
                        completedHands++;
                    }
                }
                expect(patterns.size).toBeGreaterThan(0);
                expect(completedHands).toBeGreaterThan(20);
                const simulated = simulatorPatterns(config);
                const differences = compareContinuousSimulator(config, report, speed);
                const summary = {name, native_patterns: [...patterns].sort(),
                    fresh_full_hand_patterns: [...simulated], hands: completedHands, replay_differences: assessment?.differences.length,
                    simulator_differences: differences, independent_replay_differences: assessment?.differences ?? []};
                fs.writeFileSync(path.join(capture.directory, "findings.json"), JSON.stringify(summary, null, 2) + "\n");
                if (process.env.BELT_SPEED_DISCOVERY !== "1") {
                    const baseline = JSON.parse(fs.readFileSync(path.join(fixture, "speed-expectations.json"), "utf8"));
                    expect({patterns: summary.native_patterns, simulator_agrees: differences.length === 0,
                        replay_agrees: !assessment?.differences.length, hands: completedHands,
                        model_difference_count: differences.length, model_first_difference: differences[0] ?? null,
                        replay_difference_count: assessment?.differences.length ?? 0}).toEqual(baseline[name]);
                }
            } finally {capture.cleanup();}
        }, 240_000);
    }
