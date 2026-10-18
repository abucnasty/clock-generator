import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {Config} from "../../../../src/config";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {InserterPickupMode} from "../../../../src/control-logic/inserter/modes/pickup/pickup-mode";

interface Stack {id: number; at: number; count: number; item: string}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Sample {
    tick: number; held: number; held_item?: string; lines: Line[];
    downstream: Line[];
    inputs: unknown; output: unknown; crafting_progress: number;
}
const stacks = (line: Line): Stack[] => Object.values(line.stacks);

function ordinaryBeltHand(config: Config, backedUp: boolean, item = "iron-plate", startTick = 0): number[] {
    const candidate = structuredClone(config);
    candidate.overrides = {...candidate.overrides, backed_up_belts: backedUp};
    candidate.inserters[1].filters = [item];
    const simulation = SimulationContext.fromConfig(candidate);
    const input = simulation.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const mode = InserterPickupMode.create({inserterState: input, tick_provider: simulation.tick_provider,
        sourceState: simulation.state_registry.getStateByEntityIdOrThrow(input.inserter.source.entity_id),
        sinkState: simulation.state_registry.getStateByEntityIdOrThrow(input.inserter.sink.entity_id)});
    const counts: number[] = [];
    for (let tick = startTick; tick < startTick + 10; tick++) {
        simulation.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
        expect(input.held_item?.item_name).toBe(item);
        counts.push(input.held_item!.quantity);
        if (input.held_item!.quantity === 16) return counts;
    }
    throw new Error("ordinary belt comparison did not fill");
}

for (const swapped of [false, true]) test(`turbo splitter: direct pickup from its right-priority output${swapped ? " (ingredients swapped)" : ""}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.SPLITTER_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, swapped ? "swapped" : "original") : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-pickup-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const fixture = GameFixturePaths.SPLITTER;
        const preferredItem = swapped ? "copper-cable" : "iron-plate";
        const otherItem = swapped ? "iron-plate" : "copper-cable";
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        const original = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8").trim();
        const decoded = JSON.parse(zlib.inflateSync(Buffer.from(original.slice(1), "base64")).toString());
        if (swapped) {
            const changed = [];
            for (const entity of decoded.blueprint.entities) {
                for (const filter of entity.infinity_settings?.filters ?? []) {
                    expect(["iron-plate", "copper-cable"]).toContain(filter.name);
                    filter.name = filter.name === "iron-plate" ? "copper-cable" : "iron-plate";
                    changed.push(entity.entity_number);
                }
            }
            expect(changed).toEqual([1, 5, 6, 10]);
            config.belts[0].lanes.reverse();
        }
        const input = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === 14);
        expect(input).toMatchObject({name: "stack-inserter", direction: 12, position: {x: -71.5, y: 414.5}});
        // Preserve the physical fixture and hold only the target during natural supply warm-up.
        input.control_behavior = {circuit_enabled: true,
            circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
        decoded.blueprint.entities.push({entity_number: 22, name: "constant-combinator", position: {x: -72.5, y: 416.5}});
        decoded.blueprint.wires = [[14, 1, 22, 1]];
        const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
        const lua = composeProbeSource(path.join(fixture, "probe.lua"));
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        fs.writeFileSync(path.join(scratch, "config.json"), JSON.stringify(config, null, 2) + "\n");
        fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
        const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 60, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/splitter-pickup.json"), "utf8")) as {
            initial: {lines: Line[]}; samples: Sample[];
        };
        expect(report.samples).toHaveLength(60);
        expect(report.initial).toMatchObject({splitter_name: "turbo-splitter", splitter_direction: 4,
            output_priority: "right", input_priority: "none", inserter_direction: 12, mirrored: false, use_filters: false,
            recipe: "electronic-circuit", crafting_speed: 5, machine_active: true});
        expect(report.initial).not.toHaveProperty("filter");
        expect(report.initial.lines.map(l => l.length)).toEqual([179 / 256, 179 / 256, 179 / 256, 179 / 256, 0.5, 0.5, 0.5, 0.5]);
        expect(stacks(report.initial.lines[6]).map(s => [s.at, s.item, s.count])).toEqual([[0, preferredItem, 4], [0.25, preferredItem, 4]]);
        expect(stacks(report.initial.lines[7]).map(s => [s.at, s.item, s.count])).toEqual([[0, otherItem, 4], [0.25, otherItem, 4]]);
        const firstFull = report.samples.find(s => s.held === 16)!;
        expect(firstFull.tick).toBe(5);
        const firstHand = report.samples.filter(s => s.tick <= firstFull.tick);
        expect(firstHand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
        expect(firstHand.every(s => JSON.stringify(s.lines[7]) === JSON.stringify(report.initial.lines[7]))).toBe(true);
        const grabs = firstHand.filter((s, i) => s.held > (firstHand[i - 1]?.held ?? 0));
        expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(preferredItem));
        const counts = firstHand.filter(s => s.held > 0).map(s => s.held);
        expect(counts).toEqual([4, 8, 12, 16]);
        expect(ordinaryBeltHand(config, false, preferredItem)).toEqual(counts);
        expect(ordinaryBeltHand(config, true, preferredItem)).toEqual(counts);
        // Trace the previous observation's location, not a claim that an inserter reaches an input line.
        // The splitter may route a stack and the inserter may consume it between adjacent samples.
        const priorLines = grabs.map(grab => {
            const previous = report.samples.find(s => s.tick === grab.tick - 1)!;
            // Account for draining north-output stacks as transfers, not pickups.
            const present = new Set([...grab.lines, ...grab.downstream].flatMap(l => stacks(l).map(s => s.id)));
            const lost = previous.lines.flatMap((line, index) => stacks(line)
                .filter(s => !present.has(s.id)).map(stack => ({line: index + 1, stack})));
            expect(lost).toHaveLength(1);
            expect(lost[0].stack).toMatchObject({item: preferredItem, count: 4});
            return lost[0].line;
        });
        expect(priorLines).toEqual([7, 1, 7, 1]);
        const hands: {item: string; ticks: number[]}[] = [];
        for (const [index, sample] of report.samples.entries()) {
            const before = report.samples[index - 1]?.held ?? 0;
            if (sample.held > before) {
                expect(sample.held - before).toBe(4);
                if (before === 0) hands.push({item: sample.held_item!, ticks: []});
                expect(sample.held_item).toBe(hands.at(-1)!.item);
                hands.at(-1)!.ticks.push(sample.tick);
            }
        }
        const expectedItems = swapped ? ["copper-cable", "copper-cable", "copper-cable", "iron-plate"]
            : ["iron-plate", "copper-cable", "copper-cable", "copper-cable", "iron-plate"];
        expect(hands.map(h => h.item)).toEqual(expectedItems);
        expect(hands.map(h => h.ticks.map(tick => tick - h.ticks[0]))).toEqual([[0, 1, 2, 3], ...Array(expectedItems.length - 1).fill([0, 1, 2, 4])]);
        const secondHand = report.samples.filter(s => s.tick >= 13 && s.tick <= 17).map(s => s.held);
        expect(secondHand).toEqual([4, 8, 12, 12, 16]);
        // Ordinary saturated one-tile supply predicts a faster isolated cable hand even at the same tick.
        // This documents the current unsupported geometry, rather than changing the engine to fit one case.
        for (const backedUp of [false, true]) {
            const predicted = ordinaryBeltHand(config, backedUp, "copper-cable", 13);
            expect(predicted).toEqual([4, 8, 12, 16]);
            expect(predicted).not.toEqual(secondHand);
        }
        const captureIndex = result.recording.config.inserters.findIndex(i => i.source.type === "belt" && i.sink.type === "machine");
        expect(captureIndex).toBeGreaterThanOrEqual(0);
        const captured = result.recording.config.inserters[captureIndex];
        expect(captured.source).not.toHaveProperty("pickup_length");
        expect(captured.source).not.toHaveProperty("near_lane");
        expect(result.recording.config.pickup_warnings).toContainEqual({inserter_id: captureIndex + 1, reason: "splitter"});
    } finally { if (!retained) fs.rmSync(scratch, {recursive: true, force: true}); }
}, 240_000);
