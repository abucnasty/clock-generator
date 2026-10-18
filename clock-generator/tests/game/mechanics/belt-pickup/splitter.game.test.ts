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
import {advanceRightPrioritySplitter, SplitterStack} from "./splitter-replay";

interface Stack {id: number; at: number; count: number; item: string}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Sample {
    tick: number; held: number; held_item?: string; lines: Line[];
    downstream: Line[]; upstream: Line[];
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

for (const {name, swapped, mirrored, label} of [
    {name: "original", swapped: false, mirrored: false, label: ""},
    {name: "swapped", swapped: true, mirrored: false, label: " (ingredients swapped)"},
    {name: "swapped-mirrored", swapped: true, mirrored: true, label: " (ingredients swapped, mirrored)"},
    {name: "blocked-drain", swapped: false, mirrored: false, label: " (drain removed)"},
    {name: "no-priority", swapped: false, mirrored: false, label: " (priority unset)"},
    {name: "no-priority-blocked-drain", swapped: false, mirrored: false, label: " (priority unset, drain removed)"},
]) test(`turbo splitter: direct pickup from its output${label}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.SPLITTER_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, name) : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-pickup-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const fixture = GameFixturePaths.SPLITTER;
        const line7Item = swapped ? "copper-cable" : "iron-plate";
        const line8Item = swapped ? "iron-plate" : "copper-cable";
        const preferredItem = mirrored ? line8Item : line7Item;
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
        const blockedDrain = name.endsWith("blocked-drain");
        const outputPriority = name.startsWith("no-priority") ? "none" : "right";
        if (outputPriority === "none") {
            const splitter = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === 12);
            delete splitter.output_priority;
        }
        if (blockedDrain) {
            const drain = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === 20);
            expect(drain).toMatchObject({name: "turbo-loader", type: "input"});
            decoded.blueprint.entities = decoded.blueprint.entities.filter((e: {entity_number: number}) => e.entity_number !== 20);
        }
        const input = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === 14);
        expect(input).toMatchObject({name: "stack-inserter", direction: 12, position: {x: -71.5, y: 414.5}});
        if (mirrored) input.mirror = true;
        // Preserve the physical fixture and hold only the target during natural supply warm-up.
        input.control_behavior = {circuit_enabled: true,
            circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
        decoded.blueprint.entities.push({entity_number: 22, name: "constant-combinator", position: {x: -72.5, y: 416.5}});
        decoded.blueprint.wires = [[14, 1, 22, 1]];
        const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
        const lua = composeProbeSource(path.join(fixture, "probe.lua"), {mirrored, blockedDrain, outputPriority});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        fs.writeFileSync(path.join(scratch, "config.json"), JSON.stringify(config, null, 2) + "\n");
        fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
        const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 60, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/splitter-pickup.json"), "utf8")) as {
            initial: {lines: Line[]; downstream: Line[]; upstream: Line[]}; samples: Sample[];
        };
        expect(report.samples).toHaveLength(60);
        if (name === "original") {
            const stock = (lines: Line[]): SplitterStack[][] => lines.map(line => stacks(line).map(stack => ({
                id: stack.id, position: Math.round(stack.at * 256), item: stack.item, count: stack.count,
            })));
            let predicted = stock(report.initial.lines);
            let previous = {...report.initial, held: 0};
            for (const sample of report.samples) {
                predicted = advanceRightPrioritySplitter(predicted, {
                    upstream: stock(previous.upstream),
                    take: sample.held > previous.held ? {item: sample.held_item!, count: sample.held - previous.held} : undefined,
                });
                expect(predicted, `continuous splitter replay at tick ${sample.tick}`).toEqual(stock(sample.lines));
                previous = sample;
            }
        }
        expect(report.initial).toMatchObject({splitter_name: "turbo-splitter", splitter_direction: 4,
            drain_present: !blockedDrain, output_priority: outputPriority, input_priority: "none", inserter_direction: 12, mirrored, use_filters: false,
            recipe: "electronic-circuit", crafting_speed: 5, machine_active: true});
        expect(report.initial).not.toHaveProperty("filter");
        expect(report.initial.lines.map(l => l.length)).toEqual([179 / 256, 179 / 256, 179 / 256, 179 / 256, 0.5, 0.5, 0.5, 0.5]);
        expect(stacks(report.initial.lines[6]).map(s => [s.at, s.item, s.count])).toEqual([[0, line7Item, 4], [0.25, line7Item, 4]]);
        expect(stacks(report.initial.lines[7]).map(s => [s.at, s.item, s.count])).toEqual([[0, line8Item, 4], [0.25, line8Item, 4]]);
        const firstFull = report.samples.find(s => s.held === 16)!;
        expect(firstFull.tick).toBe(outputPriority === "none" && !blockedDrain ? 7 : 5);
        const firstHand = report.samples.filter(s => s.tick <= firstFull.tick);
        expect(firstHand.every(s => JSON.stringify(s.inputs) === "{}" && JSON.stringify(s.output) === "{}" && s.crafting_progress === 0)).toBe(true);
        const untouchedLine = mirrored ? 6 : 7;
        expect(firstHand.every(s => JSON.stringify(s.lines[untouchedLine]) === JSON.stringify(report.initial.lines[untouchedLine]))).toBe(true);
        const grabs = firstHand.filter((s, i) => s.held > (firstHand[i - 1]?.held ?? 0));
        expect(grabs.map(s => s.held_item)).toEqual(Array(4).fill(preferredItem));
        const counts = grabs.map(s => s.held);
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
        expect(priorLines).toEqual(mirrored ? [8, 2, 8, 2] : [7, 1, 7, 1]);
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
        const expectedItems = outputPriority === "none" && !blockedDrain ? ["iron-plate", "copper-cable", "copper-cable", "iron-plate", "copper-cable"]
            : blockedDrain ? ["iron-plate", "copper-cable", "copper-cable", "copper-cable", "iron-plate", "copper-cable"]
            : swapped && !mirrored ? ["copper-cable", "copper-cable", "copper-cable", "iron-plate"]
            : ["iron-plate", "copper-cable", "copper-cable", "copper-cable", "iron-plate"];
        expect(hands.map(h => h.item)).toEqual(expectedItems);
        if (outputPriority === "none" && !blockedDrain) {
            expect(hands.map(h => h.ticks)).toEqual([[2, 3, 4, 7], [15, 16, 17, 21], [29, 30, 33, 37],
                [45, 46, 47, 51], [59, 60]]);
            const waiting = stacks(report.samples[3].lines[0]).find(s => s.at === 19 / 256)!;
            expect(waiting).toMatchObject({item: "iron-plate", count: 4});
            expect(stacks(report.samples[4].lines[4])).toContainEqual({...waiting, at: 0.25});
        } else expect(hands.map(h => h.ticks.map(tick => tick - h.ticks[0]))).toEqual(blockedDrain
            ? Array(6).fill([0, 1, 2, 3]) : [[0, 1, 2, 3], ...Array(expectedItems.length - 1).fill([0, 1, 2, 4])]);
        if (blockedDrain) {
            expect(hands.map(h => h.ticks)).toEqual([[2, 3, 4, 5], [13, 14, 15, 16], [24, 25, 26, 27],
                [35, 36, 37, 38], [46, 47, 48, 49], [57, 58, 59, 60]]);
            expect(report.samples[0].lines).toEqual(report.initial.lines);
            for (const sample of report.samples) {
                expect(sample.lines.slice(4, 6)).toEqual(report.initial.lines.slice(4, 6));
                expect(sample.downstream).toEqual(report.initial.downstream);
            }
        }
        const secondHand = report.samples.filter(s => s.tick >= hands[1].ticks[0] && s.tick <= hands[1].ticks.at(-1)!).map(s => s.held);
        expect(secondHand).toEqual(blockedDrain ? [4, 8, 12, 16] : outputPriority === "none"
            ? [4, 8, 12, 12, 12, 12, 16] : [4, 8, 12, 12, 16]);
        // Ordinary saturated one-tile supply predicts a faster isolated cable hand even at the same tick.
        // This documents the current unsupported geometry, rather than changing the engine to fit one case.
        for (const backedUp of [false, true]) {
            const predicted = ordinaryBeltHand(config, backedUp, "copper-cable", hands[1].ticks[0]);
            expect(predicted).toEqual([4, 8, 12, 16]);
            if (!blockedDrain) expect(predicted).not.toEqual(secondHand);
            else expect(predicted).toEqual(secondHand.slice(0, 4));
        }
        const captureIndex = result.recording.config.inserters.findIndex(i => i.source.type === "belt" && i.sink.type === "machine");
        expect(captureIndex).toBeGreaterThanOrEqual(0);
        const captured = result.recording.config.inserters[captureIndex];
        expect(captured.source).toMatchObject({pickup_capture: {
            status: "unsupported", reason: "splitter", entity_type: "splitter", entity_name: "turbo-splitter",
        }});
        expect(captured.source).not.toHaveProperty("pickup_length");
        expect(captured.source).not.toHaveProperty("near_lane");
        expect(result.recording.config.pickup_warnings).toContainEqual({inserter_id: captureIndex + 1, reason: "splitter"});
    } finally { if (!retained) fs.rmSync(scratch, {recursive: true, force: true}); }
}, 240_000);
