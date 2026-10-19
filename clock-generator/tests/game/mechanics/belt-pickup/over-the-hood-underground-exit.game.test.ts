import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {Config} from "../../../../src/config";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {BELT_SPEEDS, configAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {assessSameItemPickups} from "./same-item-pickup-probe";
import {replayJammedPickups} from "./jammed-pickup-replay";
import {overTheHoodExitAtSpeed, overTheHoodReleaseDelays, overTheHoodReplayRoot} from "./over-the-hood-exit-fixtures";

interface Identity {name: string; type: string; direction: number; position: {x: number; y: number}; endpoint?: string}
interface Stack {at: number; count: number; item: string; id: number}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Sample {
    tick: number; held: number; held_item?: string; hand: {x: number; y: number}; enabled: boolean; circuit_disabled: boolean;
    lines: Line[]; neighbour_lines: Line[]; inputs: unknown; output: unknown; crafting_progress: number;
}
interface Report {
    input: Identity; machine: Identity; belt: Identity; neighbour: Identity; samples: Sample[];
    release_delay?: number; machine_quality: string; crafting_speed: number; quality: string; hand_capacity: number; mirrored: boolean; speed: number; recipe: string; ingredient_drains: number;
    ingredient_pairs: {position: {x: number; y: number}; partner: {x: number; y: number}}[];
}
const stock = (line: Line) => Object.values(line.stacks);
const phase = (line: Line) => ((Math.round(stock(line)[0].at * 256) % 64) + 64) % 64;
const laneOf = (sample: Sample, beltY: number): 1 | 2 => sample.hand.y < beltY ? 1 : 2;

for (const compact of [false, true]) for (const speed of BELT_SPEEDS) for (const mirrored of [false, true])
    for (const backed of [false, true]) for (const content of ["original", "swapped", "same-item"] as const)
        for (const releaseDelay of overTheHoodReleaseDelays(speed, compact, backed, process.env.OVER_HOOD_PHASES === "1")) {
        const baseName = `${speed.name}-${compact ? "compact" : "plant"}-${mirrored ? "mirrored" : "unmirrored"}-${backed ? "backed" : "moving"}-${content}`;
        const name = baseName + (releaseDelay ? `-release-${releaseDelay}` : "");
        const gateTick = 64 + releaseDelay;
        test(name, async context => {
            context.skip(!compact && speed.name === "normal", "Original seven-tile source tunnel exceeds normal range; use matched compact controls");
            const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
            const replayRoot = overTheHoodReplayRoot(releaseDelay, process.env.OVER_HOOD_REPLAY_DIR, process.env.OVER_HOOD_PHASE_REPLAY_DIR);
            context.skip(!replayRoot && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
            const fixture = GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT;
            const capture = replayRoot ? {directory: path.resolve(replayRoot, name), cleanup() {}} : speedCapture(name);
            try {
                const source = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8");
                const blueprint = overTheHoodExitAtSpeed(source, speed, {compactDestination: compact, mirrored, backedUp: backed, content, gated: true});
                if (replayRoot) expect(fs.readFileSync(path.join(capture.directory, "scaffold.txt"), "utf8")).toBe(blueprint);
                else {
                    const config = await loadConfigFromFile(path.join(GameFixturePaths.FRONT_UNDERGROUND_EXIT, "config.json"));
                    configAtSpeed(config, speed);
                    config.overrides = {...config.overrides, backed_up_belts: backed};
                    const lanes = config.belts.find(belt => belt.id === 2)!.lanes;
                    if (content === "swapped") lanes.reverse();
                    if (content === "same-item") lanes.forEach(lane => {lane.ingredient = "accumulator";});
                    if (compact) {
                        config.target_output.recipe = "electronic-circuit";
                        config.machines[0] = {...config.machines[0], recipe: "electronic-circuit", productivity: 0, crafting_speed: 70.765625};
                        config.belts.find(belt => belt.id === 1)!.lanes[0].ingredient = "electronic-circuit";
                        lanes.forEach(lane => {lane.ingredient = lane.ingredient === "accumulator" ? "iron-plate" : "copper-cable";});
                    }
                    fs.writeFileSync(path.join(capture.directory, "scaffold.txt"), blueprint);
                    await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                        lua: composeProbeSource(path.join(fixture, "probe.lua"), {compact, mirrored, backed, speed: speed.units / 32, prefix: speed.prefix, release_delay: releaseDelay}),
                        out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                        ticks: 150 + releaseDelay, warmup_ticks: 0, staged_start: {build_order: "ascending", saturation_ticks: 1600},
                        settle_ticks: 0, seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
                }
                const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/over-the-hood-exit.json"), "utf8")) as Report;
                expect(report).toMatchObject({quality: "legendary", machine_quality: "legendary", hand_capacity: 16, mirrored, speed: speed.units / 32,
                    recipe: compact ? "electronic-circuit" : "electromagnetic-science-pack", ingredient_drains: backed ? 0 : 1});
                expect(report.belt).toMatchObject({name: `${speed.prefix}underground-belt`, direction: 4, endpoint: "output"});
                expect(report.machine.name).toBe(compact ? "assembling-machine-3" : "electromagnetic-plant");
                expect(report.machine.position).toEqual({x: report.belt.position.x - (compact ? 3 : 3.5),
                    y: report.belt.position.y + (compact ? 0 : 0.5)});
                expect(report.crafting_speed).toBeCloseTo(compact ? 70.765625 : 109.475, 6);
                expect(report.input.direction).toBe(4);
                expect(report.input.position).toEqual({x: report.belt.position.x - 1, y: report.belt.position.y});
                expect(report.neighbour).toMatchObject({name: `${speed.prefix}underground-belt`, direction: 4, endpoint: "input"});
                expect(report.neighbour.position).toEqual({x: report.belt.position.x - (compact ? 5 : 7), y: report.belt.position.y});
                expect(report.ingredient_pairs).toHaveLength(6);
                const maxDistance = speed.name === "normal" ? 5 : speed.name === "fast" ? 7 : speed.name === "express" ? 9 : 11;
                expect(report.ingredient_pairs.every(pair => pair.position.y === pair.partner.y
                    && Math.abs(pair.position.x - pair.partner.x) <= maxDistance)).toBe(true);
                expect(report.release_delay ?? 0).toBe(releaseDelay);
                expect(report.samples).toHaveLength(128 + releaseDelay);
                expect(report.samples.every(sample => JSON.stringify(sample.lines.map(line => line.length)) === "[0.5,0.5,1,1]")).toBe(true);
                expect(report.samples.slice(0, gateTick).every(sample => sample.held === 0 && !sample.enabled && sample.circuit_disabled)).toBe(true);
                const seed = report.samples[gateTick - 1];
                const ingredients = content === "same-item" ? ["accumulator", "accumulator"]
                    : content === "swapped" ? ["supercapacitor", "accumulator"] : ["accumulator", "supercapacitor"];
                const items = ingredients.map(item => compact ? item === "accumulator" ? "iron-plate" : "copper-cable" : item);
                for (let lane = 0; lane < 2; lane++) {
                    expect(seed.lines[lane].length).toBe(0.5);
                    expect(stock(seed.lines[lane])).toHaveLength(2);
                    expect(stock(seed.lines[lane]).every(stack => stack.count === 4 && stack.item === items[lane])).toBe(true);
                    if (backed) expect(stock(seed.lines[lane]).map(stack => Math.round(stack.at * 256))).toEqual([0, 64]);
                    expect(phase(seed.lines[lane])).toBe(backed ? 0
                        : (phase(report.samples[63].lines[lane]) - releaseDelay * speed.units * 8 + 512) % 64);
                    for (let index = 57; index < 64; index++) {
                        const previous = phase(report.samples[index - 1].lines[lane]);
                        expect(phase(report.samples[index].lines[lane])).toBe(backed ? previous : (previous - speed.units * 8 + 64) % 64);
                    }
                }
                const full = report.samples.find(sample => sample.held === 16);
                expect(full).toBeDefined();
                const hand = report.samples.filter(sample => sample.tick <= full!.tick);
                expect(hand.every(sample => JSON.stringify(sample.inputs) === "{}" && JSON.stringify(sample.output) === "{}" && sample.crafting_progress === 0)).toBe(true);
                const grabs = hand.filter((sample, index) => sample.held > (hand[index - 1]?.held ?? 0));
                expect(grabs.map(sample => sample.held)).toEqual([4, 8, 12, 16]);
                const selected = grabs.map(sample => laneOf(sample, report.belt.position.y));
                const preferred = selected[0];
                const item = items[preferred - 1];
                expect(grabs.every(sample => sample.held_item === item)).toBe(true);
                if (content !== "same-item") expect(selected.every(lane => lane === preferred)).toBe(true);
                // Track real IDs across both endpoints. A stack may enter the exposed window and be
                // grabbed in the same tick, so the prior visible tail is not necessarily the selected stack.
                const withdrawn = (previous: Sample, current: Sample, lane: number) => {
                    const visible = stock(previous.lines[lane]).filter(stack => backed || stack.at * 256 >= speed.units * 8);
                    const incoming = stock(previous.neighbour_lines[lane + 2]).filter(stack => stack.at * 256 < speed.units * 8);
                    const after = new Set([...current.lines, ...current.neighbour_lines].flatMap(line => stock(line).map(stack => stack.id)));
                    return [...visible, ...incoming].filter(stack => !after.has(stack.id));
                };
                for (const grab of grabs) {
                    const previous = report.samples[grab.tick - 2];
                    const lane = laneOf(grab, report.belt.position.y) - 1;
                    // Moving stacks already within one tick of the downstream edge can leave naturally;
                    // every other disappeared reachable ID must be the observed four-item pickup.
                    expect(withdrawn(previous, grab, lane)).toHaveLength(1);
                    expect(withdrawn(previous, grab, 1 - lane)).toHaveLength(0);
                }
                const previousFirst = report.samples[grabs[0].tick - 2];
                for (let lane = 0; lane < 2; lane++) expect(stock(previousFirst.lines[lane])).toHaveLength(2);
                const samples = hand.map(sample => ({...sample, lanes: sample.lines.slice(0, 2)}));
                const moving = backed ? undefined : assessSameItemPickups({endpoint: "output", stack_size: 16, samples},
                    speed.units, preferred, gateTick + 1, content === "same-item" ? undefined : preferred);
                const jammed = backed ? replayJammedPickups({item, belt_speed: speed.units / 32, stack_size: 16, samples}, gateTick, preferred) : undefined;
                if (moving) expect(moving.hands).toBe(1);
                const recording = JSON.parse(fs.readFileSync(path.join(capture.directory, "recording.json"), "utf8")) as {config: Config & {pickup_warnings?: unknown[]}};
                const exported = recording.config.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
                expect(exported.source).toMatchObject({pickup_capture: {status: "unsupported", reason: "inline",
                    entity_type: "underground-belt", entity_name: `${speed.prefix}underground-belt`}});
                expect(exported.source).not.toHaveProperty("near_lane");
                expect(exported.source).not.toHaveProperty("pickup_length");
                expect(recording.config.pickup_warnings).toContainEqual({inserter_id: recording.config.inserters.indexOf(exported) + 1, reason: "inline"});
                const summary = {crafting_speed: report.crafting_speed,
                    internal_stock_seen: report.samples.some(sample => sample.lines.slice(2).some(line => stock(line).length > 0)), first_grab: grabs[0].tick, item, preferred, selected,
                    offsets: grabs.map(sample => sample.tick - grabs[0].tick),
                    first_grab_phases: grabs[0].lines.slice(0, 2).map(line => stock(line).length ? phase(line) : null),
                    moving_differences: moving?.differences ?? [], jammed_differences: jammed?.differences ?? []};
                fs.writeFileSync(path.join(capture.directory, "findings.json"), JSON.stringify(summary, null, 2) + "\n");
                if (process.env.OVER_HOOD_DISCOVERY !== "1") {
                    const expected = JSON.parse(fs.readFileSync(path.join(fixture, releaseDelay ? "phase-expectations.json" : "expectations.json"), "utf8"));
                    expect(summary).toEqual(expected[name]);
                }
            } finally {capture.cleanup();}
        }, 240_000);
    }
