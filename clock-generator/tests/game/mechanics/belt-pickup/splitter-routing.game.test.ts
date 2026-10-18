import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {EntityState, MachineState} from "../../../../src/state";
import {composeProbeSource} from "../../helpers/probe-source";

interface Stack {id: number; at: number; count: number; item: string}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Sample {
    tick: number; held: number; held_item?: string; lines: Line[]; downstream: Line[];
    inputs: {name: string; count: number}[] | Record<string, never>;
}
interface Hand {item: string; ticks: number[]}
const stacks = (line: Line): Stack[] => Object.values(line.stacks);

for (const variant of [
    {name: "left-priority", priority: "left", mirrored: false, reflected: false, southInput: false, filter: undefined},
    {name: "filter-cable", priority: "right", mirrored: false, reflected: false, southInput: false, filter: "copper-cable"},
    {name: "filter-iron", priority: "right", mirrored: false, reflected: false, southInput: false, filter: "iron-plate"},
    {name: "south-input", priority: "right", mirrored: false, reflected: false, southInput: true, filter: undefined},
    {name: "north-port", priority: "left", mirrored: false, reflected: true, southInput: false, filter: undefined},
    {name: "north-port-mirrored", priority: "left", mirrored: true, reflected: true, southInput: false, filter: undefined},
]) test(`turbo splitter routing: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.SPLITTER_ROUTING_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, variant.name) : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-routing-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_ROUTING_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const fixture = GameFixturePaths.SPLITTER;
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        const original = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8").trim();
        const decoded = JSON.parse(zlib.inflateSync(Buffer.from(original.slice(1), "base64")).toString());
        for (const entity of decoded.blueprint.entities) {
            if (variant.southInput && entity.entity_number <= 11) entity.position.y += 1;
            if (variant.reflected) {
                entity.position.y = 828 - entity.position.y;
                if ((entity.direction ?? 0) === 0) entity.direction = 8;
                else if (entity.direction === 8) entity.direction = 0;
            }
        }
        const splitter = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === 12);
        splitter.output_priority = variant.priority;
        if (variant.filter) splitter.filter = variant.filter;
        const input = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === 14);
        input.mirror = variant.mirrored;
        input.control_behavior = {circuit_enabled: true,
            circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
        decoded.blueprint.entities.push({entity_number: 22, name: "constant-combinator", position: {x: -72.5, y: variant.reflected ? 411.5 : 416.5}});
        decoded.blueprint.wires = [[14, 1, 22, 1]];
        const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
        const lua = composeProbeSource(path.join(fixture, "probe.lua"), {...variant, outputPriority: variant.priority});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        fs.writeFileSync(path.join(scratch, "config.json"), JSON.stringify(config, null, 2) + "\n");
        fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
        const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 60, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/splitter-pickup.json"), "utf8")) as {
            initial: {lines: Line[]; output_priority: string; filter?: {name: string; quality: string; comparator: string}; mirrored: boolean}; samples: Sample[];
        };
        expect(report.samples).toHaveLength(60);
        expect(report.initial).toMatchObject({output_priority: variant.priority, mirrored: variant.mirrored});
        if (variant.filter) expect(report.initial.filter).toEqual({name: variant.filter, quality: "normal", comparator: "="});
        else expect(report.initial.filter).toBeUndefined();
        const hands: Hand[] = [];
        for (const [index, sample] of report.samples.entries()) {
            const before = report.samples[index - 1]?.held ?? 0;
            if (sample.held > before) {
                expect(sample.held - before).toBe(4);
                if (before === 0) hands.push({item: sample.held_item!, ticks: []});
                expect(sample.held_item).toBe(hands.at(-1)!.item);
                hands.at(-1)!.ticks.push(sample.tick);
            }
        }
        const expectations = JSON.parse(fs.readFileSync(path.join(fixture, "routing-expectations.json"), "utf8"));
        expect(hands).toEqual(expectations[variant.name].hands);
        const initialStock = report.initial.lines.map(line => stacks(line).map(s => ({item: s.item, count: s.count, at: s.at})));
        expect(initialStock).toEqual(expectations[variant.name].initial_stock);
        if (hands.length) {
            const first = hands[0];
            const trace = first.ticks.map(tick => {
                const sample = report.samples[tick - 1], previous = report.samples[tick - 2];
                const present = new Set([...sample.lines, ...sample.downstream].flatMap(l => stacks(l).map(s => s.id)));
                const lost = previous.lines.flatMap((line, index) => stacks(line)
                    .filter(s => !present.has(s.id)).map(stack => ({line: index + 1, stack})));
                expect(lost).toHaveLength(1);
                expect(lost[0].stack).toMatchObject({item: first.item, count: 4});
                return lost[0].line;
            });
            expect(trace).toEqual(expectations[variant.name].first_trace);
        } else expect(report.samples.every(s => s.held === 0)).toBe(true);
        if (variant.filter) {
            const simulation = SimulationContext.fromConfig(config);
            const machine = simulation.state_registry.getAllStates().find(EntityState.isMachine)!;
            const final = report.samples.at(-1)!;
            for (const item of Object.values(final.inputs)) machine.inventoryState.setQuantity(item.name, item.count);
            expect(MachineState.machineInputIsBlocked(machine, variant.filter)).toBe(true);
            expect(final.held).toBe(0);
            expect(final.lines.slice(6).flatMap(stacks).some(s => s.item === variant.filter)).toBe(true);
        }
        const index = result.recording.config.inserters.findIndex(i => i.source.type === "belt" && i.sink.type === "machine");
        expect(index).toBeGreaterThanOrEqual(0);
        expect(result.recording.config.pickup_warnings).toContainEqual({inserter_id: index + 1, reason: "splitter"});
        expect(result.recording.config.inserters[index].source).not.toHaveProperty("pickup_length");
        expect(result.recording.config.inserters[index].source).not.toHaveProperty("near_lane");
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 240_000);
