import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {Config} from "../../../../src/config";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {InserterPickupMode} from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {BeltPickupLane} from "../../../../src/state/belt-pickup-lane";
import {EntityState} from "../../../../src/state";
import {BELT_SPEEDS, FixtureBeltSpeed, configAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {useAccumulatorsOnBothLanes} from "./belt-pickup-fixtures";
import {ordinaryAtSpeed} from "./ordinary-speed-fixtures";
import {assessSameItemPickups, SameItemPickupProbe} from "./same-item-pickup-probe";

interface Stack {at: number; count: number; item: string}
interface Sample {
    tick: number; held: number; held_item?: string; enabled?: boolean; circuit_disabled?: boolean;
    hand: {x: number; y: number}; lanes: {length: number; stacks: Stack[] | Record<string, never>}[];
}
interface Report extends SameItemPickupProbe {belt: string; item: string; belt_speed: number; gate_tick?: number; samples: Sample[]}
const modulo = (value: number, base: number) => ((value % base) + base) % base;
const phaseOf = (sample: Sample, lane: number) => modulo(Math.round(Object.values(sample.lanes[lane].stacks)[0].at * 256), 64);

/** Start from pre-gate supply. Only the native first-grab time is an observed arm-arrival condition. */
function compareFirstHand(config: Config, report: Report, speed: FixtureBeltSpeed, first: number, last: number) {
    const seed = report.samples.find(sample => sample.tick === 64)!;
    const context = SimulationContext.fromConfig(config);
    const input = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("Expected belt pickup");
    source.pickup_lanes.set(input.entity_id.id, seed.lanes.map((lane, index) => {
        const phase = modulo(phaseOf(seed, index) / 8 + seed.tick * speed.units, 8);
        return new BeltPickupLane(source.belt.belt_speed, input.inserter.pickup_length!, 4, phase);
    }));
    const mode = InserterPickupMode.create({inserterState: input, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id), tick_provider: context.tick_provider});
    const differences: {offset: number; actual: number; predicted: number}[] = [];
    for (const sample of report.samples.filter(sample => sample.tick >= first && sample.tick <= last)) {
        context.tick_provider.setCurrentTick(sample.tick);
        mode.executeForTick();
        const predicted = input.held_item?.quantity ?? 0;
        if (predicted !== sample.held) differences.push({offset: sample.tick - first, actual: sample.held, predicted});
    }
    return differences;
}

for (const speed of BELT_SPEEDS) {
    const cycle = speed.name === "turbo" ? 2 : speed.name === "fast" ? 4 : 8;
    for (const geometry of ["straight-belt", "underground-entrance", "underground-exit"]) {
        for (const ingredient of ["accumulator", "supercapacitor", "same-item"] as const) {
            for (let delay = 0; delay < cycle; delay++) {
                const baseName = `${speed.name}-${geometry}-moving-${ingredient}`;
                const name = `${baseName}-phase-${delay}`;
                test(name, async context => {
                    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
                    const baselineRoot = delay === 0 ? process.env.ORDINARY_PHASE_BASELINE_DIR : undefined;
                    const replayRoot = process.env.ORDINARY_PHASE_REPLAY_DIR;
                    context.skip(!baselineRoot && !replayRoot && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
                    const retained = baselineRoot ?? replayRoot;
                    const capture = retained ? {directory: path.resolve(retained, baselineRoot ? baseName : name), cleanup() {}} : speedCapture(name);
                    const fixture = GameFixturePaths.DIFFERENT_ITEMS;
                    try {
                        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
                        configAtSpeed(config, speed);
                        const input = config.inserters.find(i => i.source.type === "belt")!;
                        if (input.source.type !== "belt") throw new Error("Expected belt source");
                        input.source.pickup_length = geometry === "straight-belt" ? 1 : 0.5;
                        input.source.pickup_layout = geometry === "straight-belt" ? "side-straight" : geometry === "underground-entrance" ? "side-entrance" : "side-exit";
                        const wanted = ingredient === "same-item" ? "accumulator" : ingredient;
                        input.filters = [wanted];
                        let blueprint = fs.readFileSync(path.join(fixture, `${geometry}-scaffold.txt`), "utf8");
                        if (ingredient === "same-item") {
                            blueprint = useAccumulatorsOnBothLanes(blueprint);
                            config.belts.find(belt => belt.id === input.source.id)!.lanes.forEach(lane => {lane.ingredient = wanted;});
                        }
                        blueprint = ordinaryAtSpeed(blueprint, speed);
                        const gate = 64 + delay;
                        if (!retained) {
                            fs.writeFileSync(path.join(capture.directory, "blueprint.txt"), blueprint + "\n");
                            fs.writeFileSync(path.join(capture.directory, "config.json"), JSON.stringify(config, null, 2) + "\n");
                            await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                                ticks: 116, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 600},
                                settle_ticks: 0, seed: [], unclocked: true,
                                lua: composeProbeSource(path.join(fixture, "phase-probe.lua"), {item: wanted, gateTick: gate,
                                    lastTick: 112, speed: speed.units / 32, beltPrefix: speed.prefix}),
                                game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
                        }
                        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output",
                            baselineRoot ? "backed-up-pickups.json" : "ordinary-phase.json"), "utf8")) as Report;
                        expect(report.belt_speed).toBe(speed.units / 32);
                        expect(report.item).toBe(wanted);
                        expect(report.belt).toBe(`${speed.prefix}${geometry === "straight-belt" ? "transport-belt" : "underground-belt"}`);
                        expect(report.endpoint).toBe(geometry === "straight-belt" ? "straight"
                            : geometry === "underground-entrance" ? "input" : "output");
                        expect(report.gate_tick ?? 64).toBe(gate);
                        expect(report.samples.length).toBeGreaterThanOrEqual(100);
                        const heldUntilGate = report.samples.filter(sample => sample.tick <= gate);
                        expect(heldUntilGate.every(sample => sample.held === 0)).toBe(true);
                        if (!baselineRoot) expect(heldUntilGate.every(sample => sample.enabled === false && sample.circuit_disabled === true)).toBe(true);
                        const gateSample = report.samples.find(sample => sample.tick === gate)!;
                        const at64 = report.samples.find(sample => sample.tick === 64)!;
                        for (let lane = 0; lane < 2; lane++) {
                            expect(gateSample.lanes[lane].length).toBe(input.source.pickup_length);
                            const stacks = Object.values(gateSample.lanes[lane].stacks);
                            expect(stacks).toHaveLength(input.source.pickup_length * 4);
                            for (const stack of stacks) {
                                expect(stack.count).toBe(4);
                                expect(stack.item).toBe(lane === 0 || ingredient === "same-item" ? "accumulator" : "supercapacitor");
                                expect(modulo(Math.round(stack.at * 256), 64)).toBe(phaseOf(gateSample, lane));
                            }
                            expect(phaseOf(gateSample, lane)).toBe(modulo(phaseOf(at64, lane) - delay * speed.units * 8, 64));
                        }
                        const first = report.samples.find(sample => sample.held > 0)!;
                        const full = report.samples.find(sample => sample.held === 16)!;
                        expect(first.tick).toBeGreaterThan(gate);
                        expect(full.tick).toBeLessThanOrEqual(112);
                        const hand = report.samples.filter(sample => sample.tick >= first.tick && sample.tick <= full.tick);
                        expect(hand.every(sample => sample.held_item === wanted)).toBe(true);
                        const grabs = hand.filter(sample => sample.held > report.samples[sample.tick - 2].held);
                        expect(grabs.map(sample => sample.held)).toEqual([4, 8, 12, 16]);
                        for (let lane = 0; lane < 2; lane++) {
                            expect(phaseOf(first, lane)).toBe(modulo(phaseOf(gateSample, lane)
                                - (first.tick - gate) * speed.units * 8, 64));
                        }
                        const matchingLane = ingredient === "same-item" ? undefined : ingredient === "accumulator" ? 1 : 2;
                        const replay = assessSameItemPickups({...report, samples: report.samples.filter(sample => sample.tick <= full.tick)},
                            speed.units, 1, gate + 1, matchingLane);
                        expect(replay.hands).toBe(1);
                        const summary = {gate_phases: gateSample.lanes.map((_, index) => phaseOf(gateSample, index)),
                            first_grab_phases: first.lanes.map((_, index) => phaseOf(first, index)),
                            first_grab_after_gate: first.tick - gate, offsets: grabs.map(sample => sample.tick - first.tick),
                            pickup_ticks: full.tick - first.tick + 1,
                            simulator_differences: compareFirstHand(config, report, speed, first.tick, full.tick),
                            replay_differences: replay.differences};
                        const findings = process.env.ORDINARY_PHASE_FINDINGS_DIR;
                        if (findings) {
                            fs.mkdirSync(path.resolve(findings), {recursive: true});
                            fs.writeFileSync(path.resolve(findings, `${name}.json`), JSON.stringify(summary, null, 2) + "\n");
                        }
                        if (!retained) fs.writeFileSync(path.join(capture.directory, "phase-findings.json"), JSON.stringify(summary, null, 2) + "\n");
                        // Native timings are fixed observations. Differences explicitly retain known model gaps;
                        // a future timing fix should update those comparison results, not rewrite native evidence.
                        const expected = JSON.parse(fs.readFileSync(path.join(fixture, "phase-expectations.json"), "utf8"));
                        expect(summary).toEqual(expected[name]);
                    } finally {capture.cleanup();}
                }, 240_000);
            }
        }
    }
}

/** Count measured phases at first pickup, rather than assuming named release delays cover them. */
test("ordinary phase coverage spans every measured first-grab phase", () => {
    const expected = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.DIFFERENT_ITEMS, "phase-expectations.json"), "utf8")) as
        Record<string, {gate_phases: number[]; first_grab_phases: number[]}>;
    for (const speed of BELT_SPEEDS) for (const geometry of ["straight-belt", "underground-entrance", "underground-exit"])
        for (const ingredient of ["accumulator", "supercapacitor", "same-item"]) {
            const cycle = speed.name === "turbo" ? 2 : speed.name === "fast" ? 4 : 8;
            const cases = Array.from({length: cycle}, (_, delay) => expected[`${speed.name}-${geometry}-moving-${ingredient}-phase-${delay}`]);
            expect(cases.every(Boolean), `${speed.name}/${geometry}/${ingredient} missing phase capture`).toBe(true);
            for (const lane of [0, 1]) {
                expect(new Set(cases.map(value => value.gate_phases[lane])).size).toBe(cycle);
                expect(new Set(cases.map(value => value.first_grab_phases[lane])).size,
                    `${speed.name}/${geometry}/${ingredient}: lane ${lane + 1} actual first-grab phases`).toBe(cycle);
            }
        }
});
