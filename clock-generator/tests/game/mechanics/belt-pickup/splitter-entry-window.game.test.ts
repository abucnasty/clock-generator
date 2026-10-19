import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {BELT_SPEEDS, blueprintAtSpeed, configAtSpeed} from "../../helpers/belt-speed-fixtures";

interface EntryVariant {
    head: number;
    tail?: number;
    front?: number;
    inputLast?: boolean;
    otherFull?: boolean;
    fromUpstream?: boolean;
    followers?: number;
    distance?: number;
    incoming?: number;
}
interface Line {stacks: {id: number; at: number; item: string; count: number}[] | Record<string, never>}
interface Sample {tick: number; lines: Line[]; upstream: Line[]}
interface Report {
    initial: Sample & {seeded_positions: boolean; requested_head: number};
    samples: Sample[];
}
const expectedStacks = (positions: number[]) => positions.map(position => ({at: position / 256, item: "iron-plate", count: 4}));

function variantNames({head, tail, front, inputLast, otherFull, fromUpstream, followers, distance, incoming}: EntryVariant) {
    const labels = [`head ${head}`], paths = [`head-${head}`];
    const detail = (include: boolean, label: string, segment: string) => {
        if (include) { labels.push(label); paths.push(segment); }
    };
    detail(tail !== undefined, `output tail ${tail}`, `tail-${tail}`);
    detail(front !== undefined, `front ${front}`, `front-${front}`);
    detail(!!inputLast, "input seeded last", "input-last");
    detail(!!otherFull, "other lane full", "other-full");
    detail(!!fromUpstream, "upstream entry", "upstream");
    detail(!!followers, `followers ${followers}`, `followers-${followers}`);
    detail(!!distance, `distance ${distance}`, `distance-${distance}`);
    detail(incoming !== undefined, `incoming ${incoming}`, `incoming-${incoming}`);
    return {label: labels.join(", "), directory: paths.join("-")};
}

const variants: EntryVariant[] = [
    ...[0, 19, 31, 32].map(head => ({head})),
    {head: 0, tail: 0},
    ...[32, 33, 44, 45, 95, 96].map(tail => ({head: 19, tail})),
    {head: 19, tail: 96, front: 0},
    {head: 19, tail: 96, front: 32},
    {head: 0, tail: 64, front: 0},
    {head: 0, tail: 64, front: 0, inputLast: true},
    {head: 0, tail: 64, front: 0, otherFull: true},
    {head: 0, tail: 64, front: 0, fromUpstream: true},
    {head: 0, tail: 64, front: 0, followers: 1},
    {head: 0, tail: 64, front: 0, followers: 2},
    ...[65, 128, 146, 147].map(distance => ({head: 0, tail: 64, front: 0, followers: 1, distance})),
    {head: 0, followers: 1, distance: 65},
    ...[95, 96].map(distance => ({head: 0, tail: 64, front: 0, followers: 1, distance})),
    {head: 19, tail: 96, front: 0, followers: 1},
    ...[0, 18, 19].map(head => ({head, tail: 64, front: 0, followers: 2, incoming: 0})),
];

for (const speed of BELT_SPEEDS) for (const variant of ([
    ...variants,
    // At normal speed these dense-input controls bracket admission on the second tick;
    // the faster tiers bracket it on the first tick after routing the initial head.
    ...[speed.units === 1 ? 2 : speed.units * 8 - 14, speed.units === 1 ? 3 : speed.units * 8 - 13]
        .map(head => ({head, tail: 64, front: 0, followers: 2, incoming: 0})),
    // Independently bracket the step-sensitive native entry and follower admission windows.
    {head: speed.units * 8 - 1}, {head: speed.units * 8},
    {head: 0, tail: 63 + speed.units * 8}, {head: 0, tail: 64 + speed.units * 8},
    {head: 0, tail: 64, front: 0, followers: 1, distance: 63 + speed.units * 8},
    {head: 0, tail: 64, front: 0, followers: 1, distance: 64 + speed.units * 8},
] as EntryVariant[]).filter((variant, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(variant)) === index)) {
    const {head, tail, front, fromUpstream, followers, distance, incoming} = variant;
    const {label, directory} = variantNames(variant);
    test(`${speed.name} splitter entry window: seeded input ${label}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        const replay = process.env.SPLITTER_REPLAY_DIR;
        context.skip(!replay && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        const retained = replay ?? process.env.SPLITTER_ENTRY_CAPTURE_DIR;
        const scratch = retained ? path.resolve(retained, speed.name, directory) : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-entry-"));
        if (!replay && retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_ENTRY_CAPTURE_DIR");
        fs.mkdirSync(scratch, {recursive: true});
        try {
            const fixture = GameFixturePaths.SPLITTER;
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            configAtSpeed(config, speed);
            const original = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8").trim();
            const decoded = JSON.parse(zlib.inflateSync(Buffer.from(original.slice(1), "base64")).toString());
            const target = decoded.blueprint.entities.find((entity: {entity_number: number}) => entity.entity_number === 14);
            target.control_behavior = {circuit_enabled: true,
                circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
            decoded.blueprint.entities.push({entity_number: 22, name: "constant-combinator", position: {x: -72.5, y: 416.5}});
            decoded.blueprint.wires = [[14, 1, 22, 1]];
            const blueprint = blueprintAtSpeed("0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64"), speed);
            const lua = composeProbeSource(path.join(fixture, "entry-window-probe.lua"), {...variant, beltPrefix: speed.prefix, step: speed.units * 8});
            if (!replay) fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
            if (!replay) fs.writeFileSync(path.join(scratch, "config.json"), JSON.stringify(config, null, 2) + "\n");
            if (!replay) fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
            const receivesUpstream = !!fromUpstream || incoming !== undefined;
            const sampleTicks = receivesUpstream || followers ? 40 : 8;
            if (!replay) await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
                out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
                ticks: sampleTicks + 2, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
                game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
            });
            const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/splitter-entry-window.json"), "utf8")) as Report;
            expect(report.initial).toMatchObject({seeded_positions: true, requested_head: head});
            if (fromUpstream) expect(Object.values(report.initial.lines[0].stacks)).toEqual([]);
            else {
                const positions = Array.from({length: 1 + (followers ?? 0)}, (_, index) => head + index * (distance ?? 64));
                expect(Object.values(report.initial.lines[0].stacks)).toMatchObject(expectedStacks(positions));
            }
            if (fromUpstream || incoming !== undefined) expect(Object.values(report.initial.upstream[0].stacks))
                .toMatchObject(expectedStacks([incoming ?? ((head + 13) % (speed.units * 8))]));
            if (tail !== undefined) expect(Object.values(report.initial.lines[6].stacks))
                .toMatchObject(expectedStacks(front === undefined ? [tail] : [front, tail]));
            expect(report.samples).toHaveLength(sampleTicks);
            expect(report.initial.lines).toHaveLength(8);
            const lengths = (report.initial.lines as (Line & {length: number})[]).map(line => line.length);
            expect(lengths).toEqual([...Array(4).fill(179 / 256), ...Array(4).fill(0.5)]);
            const seeded = new Set([...report.initial.lines, ...report.initial.upstream]
                .flatMap(line => Object.values(line.stacks).map(stack => stack.id)));
            for (const sample of [report.initial, ...report.samples]) {
                const all = [...sample.lines, ...sample.upstream].flatMap(line => Object.values(line.stacks));
                expect(new Set(all.map(stack => stack.id)).size).toBe(all.length);
                for (const stack of all) {
                    expect(seeded.has(stack.id)).toBe(true);
                    expect(stack.count).toBe(4);
                    expect(stack.at).toBeGreaterThanOrEqual(0);
                }
            }
            // Preserve identity across routing transitions while stripping process-specific native IDs.
            const ids = new Map<number, number>();
            const stock: {id: number; item: string; count: number}[] = [];
            const normalize = (sample: Sample) => ({tick: sample.tick, lines: sample.lines.map(line =>
                Object.values(line.stacks).map(stack => {
                    if (!ids.has(stack.id)) {
                        ids.set(stack.id, ids.size + 1);
                        stock.push({id: ids.get(stack.id)!, item: stack.item, count: stack.count});
                    }
                    return [ids.get(stack.id), Math.round(stack.at * 256)];
                }))});
            const initial = normalize(report.initial);
            let previous = JSON.stringify(initial.lines);
            const changes = report.samples.flatMap(sample => {
                const state = normalize(sample), contents = JSON.stringify(state.lines);
                if (contents === previous) return [];
                previous = contents;
                return [state];
            });
            const observed = {stock, initial, changes, last_tick: report.samples.at(-1)!.tick};
            if (!replay) fs.writeFileSync(path.join(scratch, "transitions.json"), JSON.stringify(observed) + "\n");
            const expected = JSON.parse(fs.readFileSync(path.join(fixture, "entry-speed-expectations.json"), "utf8"));
            expect(observed).toEqual(expected[`${speed.name}/${directory}`]);
        } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
    }, 240_000);
}
