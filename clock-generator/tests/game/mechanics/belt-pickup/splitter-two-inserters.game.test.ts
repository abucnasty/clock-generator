import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {SimulationContext} from "../../../../src/crafting/sequence/simulation-context";
import {EntityState, MachineState} from "../../../../src/state";

interface Stack {id: number; at: number; count: number; item: string}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Hand {held: number; held_item?: string; lanes: Line[]}
interface Sample {
    tick: number; hands: Hand[]; pieces: {lines: Line[]}[];
    inputs: {name: string; count: number}[] | Record<string, never>;
    output: unknown; crafting_progress: number; products_finished: number;
}
const stacks = (line: Line): Stack[] => Object.values(line.stacks);
const priorityTicks = [[2, 3, 4, 5], [13, 14, 15, 17], [28, 29, 30, 31], [58, 59, 60, 61]];
const originalItems = [["iron-plate", "copper-cable", "iron-plate", "copper-cable"], Array(4).fill("copper-cable")];
const measured: Record<string, {items: string[][]; ticks: number[][][]; products: number}> = {
    original: {items: originalItems, ticks: [priorityTicks, priorityTicks], products: 27},
    swapped: {
        items: [Array(5).fill("copper-cable"), ["iron-plate", "copper-cable", "iron-plate", "copper-cable"]],
        ticks: [[...priorityTicks, [88, 89, 90, 91]], [...priorityTicks.slice(0, 3), [58, 59, 60, 88]]], products: 27,
    },
    "swapped-left-mirrored": {
        items: [["iron-plate", ...Array(4).fill("copper-cable")], ["iron-plate", ...Array(3).fill("copper-cable")]],
        ticks: [
            [priorityTicks[0], priorityTicks[1], [25, 26, 27, 29], [70, 71, 72, 73], [100, 101, 102, 103]],
            [priorityTicks[0], priorityTicks[1], [25, 26, 27, 29], [70, 71, 72, 100]],
        ], products: 24,
    },
    "no-priority": {
        items: originalItems,
        ticks: [
            [[2, 3, 4, 7], [15, 16, 17, 21], [30, 31, 32, 35], [60, 61, 62, 65]],
            [[2, 3, 4, 7], [15, 16, 19, 23], [31, 32, 35, 39], [60, 61, 62, 65]],
        ], products: 27,
    },
    "swapped-right-unmirrored": {
        items: Array.from({length: 2}, () => ["copper-cable", "copper-cable", "iron-plate", "copper-cable"]),
        ticks: Array.from({length: 2}, () => [priorityTicks[0], priorityTicks[1], [25, 26, 27, 29], [82, 83, 84, 85]]),
        products: 21,
    },
    "upstream-no-priority": {
        items: originalItems,
        ticks: [
            [[2, 3, 4, 7], [15, 16, 17, 21], [30, 31, 32, 35], [60, 61, 62, 65]],
            [priorityTicks[0], priorityTicks[1], [30, 31, 32, 33], [60, 61, 62, 63]],
        ], products: 27,
    },
    "downstream-no-priority": {
        items: [["iron-plate", "copper-cable", "copper-cable", "iron-plate", "copper-cable"], Array(3).fill("copper-cable")],
        ticks: [
            [priorityTicks[0], priorityTicks[1], [25, 26, 30, 31], [39, 40, 41, 43], [60, 61, 62, 63]],
            [[2, 3, 4, 7], [15, 16, 19, 23], [31, 32, 35, 60]],
        ], products: 27,
    },
};

for (const {name, swapped, leftMirrored, rightMirrored, unsetPriorities} of [
    {name: "original", swapped: false, leftMirrored: false, rightMirrored: true, unsetPriorities: []},
    {name: "swapped", swapped: true, leftMirrored: false, rightMirrored: true, unsetPriorities: []},
    {name: "swapped-left-mirrored", swapped: true, leftMirrored: true, rightMirrored: true, unsetPriorities: []},
    {name: "no-priority", swapped: false, leftMirrored: false, rightMirrored: true, unsetPriorities: [12, 20]},
    {name: "swapped-right-unmirrored", swapped: true, leftMirrored: false, rightMirrored: false, unsetPriorities: []},
    {name: "upstream-no-priority", swapped: false, leftMirrored: false, rightMirrored: true, unsetPriorities: [12]},
    {name: "downstream-no-priority", swapped: false, leftMirrored: false, rightMirrored: true, unsetPriorities: [20]},
]) test(`two serial turbo splitters: ${name.endsWith("-no-priority") ? `${name.replace("-no-priority", "")} priority unset only`
    : name === "no-priority" ? "no priority, original" : `right priority, ${name}`}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.SPLITTER_TWO_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, name) : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-two-pickups-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_TWO_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const fixture = GameFixturePaths.SPLITTER_TWO_INSERTERS;
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        const outputPriorities = [12, 20].map(id => unsetPriorities.includes(id) ? "none" : "right");
        const original = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8").trim();
        const decoded = JSON.parse(zlib.inflateSync(Buffer.from(original.slice(1), "base64")).toString());
        for (const id of unsetPriorities) {
            const splitter = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === id);
            expect(splitter.name).toBe("turbo-splitter");
            expect(splitter.output_priority).toBe("right");
            delete splitter.output_priority;
        }
        if (swapped) {
            const changed = [];
            for (const entity of decoded.blueprint.entities) for (const filter of entity.infinity_settings?.filters ?? []) {
                expect(["iron-plate", "copper-cable"]).toContain(filter.name);
                filter.name = filter.name === "iron-plate" ? "copper-cable" : "iron-plate";
                changed.push(entity.entity_number);
            }
            expect(changed).toEqual([1, 5, 6, 10]);
            config.belts[0].lanes.reverse();
        }
        for (const id of [14, 19]) {
            const input = decoded.blueprint.entities.find((e: {entity_number: number}) => e.entity_number === id);
            expect(input.name).toBe("stack-inserter");
            if (id === 14 && leftMirrored) input.mirror = true;
            if (id === 19) input.mirror = rightMirrored;
            input.control_behavior = {circuit_enabled: true,
                circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
        }
        decoded.blueprint.entities.push({entity_number: 24, name: "constant-combinator", position: {x: -69.5, y: 418.5}});
        decoded.blueprint.wires = [[14, 1, 24, 1], [19, 1, 24, 1]];
        const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
        const lua = composeProbeSource(path.join(fixture, "probe.lua"), {leftMirrored, rightMirrored, outputPriorities});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        fs.writeFileSync(path.join(scratch, "config.json"), JSON.stringify(config, null, 2) + "\n");
        fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
        const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 120, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/splitter-two-pickups.json"), "utf8")) as {
            initial: {targets: unknown[]; state: Sample}; samples: Sample[];
        };
        expect(report.samples).toHaveLength(120);
        expect(report.initial).toMatchObject({recipe: "electronic-circuit", crafting_speed: 5, machine_active: true});
        expect(report.initial.targets).toMatchObject([
            {inserter_direction: 12, mirrored: leftMirrored, output_priority: outputPriorities[0], input_priority: "none"},
            {inserter_direction: 4, mirrored: rightMirrored, output_priority: outputPriorities[1], input_priority: "none"},
        ]);
        const expected = measured[name];
        {
            for (let index = 0; index < 2; index++) {
                const hands: {item: string; ticks: number[]}[] = [];
                let before = 0;
                for (const sample of report.samples) {
                    const hand = sample.hands[index];
                    if (hand.held > before) {
                        expect(hand.held - before).toBe(4);
                        if (before === 0) hands.push({item: hand.held_item!, ticks: []});
                        expect(hand.held_item).toBe(hands.at(-1)!.item);
                        hands.at(-1)!.ticks.push(sample.tick);
                    }
                    before = hand.held;
                }
                expect(hands.map(h => h.item)).toEqual(expected.items[index]);
                expect(hands.map(h => h.ticks)).toEqual(expected.ticks[index]);
            }
            expect(report.samples.at(-1)!.products_finished).toBe(expected.products);
        }
        for (let index = 0; index < 2; index++) {
            const preferredLine = (index === 0 ? leftMirrored : rightMirrored) ? 8 : 7;
            const item = (preferredLine === 7) !== swapped ? "iron-plate" : "copper-cable";
            const first = report.initial.state.hands[index];
            expect(first.held).toBe(0);
            expect(first.lanes).toHaveLength(8);
            expect(first.lanes.map(line => line.length)).toEqual([179 / 256, 179 / 256, 179 / 256, 179 / 256, 0.5, 0.5, 0.5, 0.5]);
            expect(stacks(first.lanes[preferredLine - 1]).map(s => [s.item, s.count, s.at]))
                .toEqual([[item, 4, 0], [item, 4, 0.25]]);
            const untouched = preferredLine === 7 ? 7 : 6;
            const trace = [];
            const firstTicks = expected.ticks[index][0];
            for (const sample of report.samples.filter(s => s.tick <= firstTicks.at(-1)!)) {
                expect(sample.inputs).toEqual({});
                expect(sample.crafting_progress).toBe(0);
                expect(sample.hands[index].held).toBe(firstTicks.filter(tick => tick <= sample.tick).length * 4);
                expect(sample.hands[index].lanes[untouched]).toEqual(first.lanes[untouched]);
                if (!firstTicks.includes(sample.tick)) continue;
                const previous = report.samples[sample.tick - 2];
                const present = new Set([...sample.hands.flatMap(h => h.lanes), ...sample.pieces.flatMap(p => p.lines)]
                    .flatMap(line => stacks(line).map(s => s.id)));
                const lost = previous.hands[index].lanes.flatMap((line, i) => stacks(line)
                    .filter(s => !present.has(s.id)).map(stack => ({line: i + 1, stack})));
                expect(lost).toHaveLength(1);
                expect(lost[0].stack).toMatchObject({item, count: 4});
                trace.push(lost[0].line);
            }
            expect(trace).toEqual(preferredLine === 7 ? [7, 1, 7, 1] : [8, 2, 8, 2]);
            if (outputPriorities[index] === "none") {
                // The refill that would finish the hand at tick 5 is instead routed to the draining north port.
                // Track the same native ID within this run; do not equate IDs between different sessions.
                const inputLine = preferredLine - 7;
                const waiting = stacks(report.samples[3].hands[index].lanes[inputLine]).find(s => s.at === 19 / 256)!;
                expect(waiting).toMatchObject({item, count: 4});
                expect(stacks(report.samples[4].hands[index].lanes[inputLine + 4]))
                    .toContainEqual({...waiting, at: 0.25});
                for (const sample of report.samples.filter(s => s.tick >= 4 && s.tick <= 6)) {
                    expect(sample.hands[index].held).toBe(12);
                    expect(stacks(sample.hands[index].lanes[preferredLine - 1])).toEqual([]);
                }
                expect(report.samples[6].hands[index].held).toBe(16);
            }
        }
        if (name === "swapped") {
            // Classify the observed late pause with the existing engine eligibility rule, not a splitter replay.
            const simulation = SimulationContext.fromConfig(config);
            const machine = simulation.state_registry.getAllStates().find(EntityState.isMachine)!;
            expect(machine.machine.inputs.get("copper-cable")!.automated_insertion_limit.quantity).toBe(39);
            for (const sample of report.samples.filter(s => s.tick >= 70 && s.tick <= 87)) {
                const previous = report.samples[sample.tick - 2];
                const cable = Object.values(previous.inputs).find(item => item.name === "copper-cable")!.count;
                machine.inventoryState.setQuantity("copper-cable", cable);
                expect(MachineState.machineInputIsBlocked(machine, "copper-cable")).toBe(true);
                expect(sample.hands[1].held).toBe(12);
                expect(stacks(sample.hands[1].lanes[6]).filter(s => s.item === "copper-cable")).toHaveLength(2);
            }
            const beforeResume = report.samples[86];
            machine.inventoryState.setQuantity("copper-cable", Object.values(beforeResume.inputs).find(item => item.name === "copper-cable")!.count);
            expect(MachineState.machineInputIsBlocked(machine, "copper-cable")).toBe(false);
            expect(report.samples[87].hands[1].held).toBe(16);
        }
        const captures = result.recording.config.inserters.flatMap((inserter, index) =>
            inserter.source.type === "belt" && inserter.sink.type === "machine" ? [{inserter, id: index + 1}] : []);
        expect(captures).toHaveLength(2);
        for (const {inserter, id} of captures) {
            expect(inserter.source).not.toHaveProperty("pickup_length");
            expect(inserter.source).not.toHaveProperty("near_lane");
            expect(result.recording.config.pickup_warnings).toContainEqual({inserter_id: id, reason: "splitter"});
        }
    } finally { if (!retained) fs.rmSync(scratch, {recursive: true, force: true}); }
}, 240_000);
