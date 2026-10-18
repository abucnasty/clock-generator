import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../../../../src/config/loader";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {advanceRightPrioritySplitter, SplitterStack} from "./splitter-replay";

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
const stock = (lines: Line[]): SplitterStack[][] => lines.map(line => Object.values(line.stacks)
    .map(stack => ({id: stack.id, position: Math.round(stack.at * 256), item: stack.item, count: stack.count})));
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

for (const variant of variants) {
    const {head, tail, front, inputLast, otherFull, fromUpstream, followers, distance, incoming} = variant;
    const {label, directory} = variantNames(variant);
    test(`turbo splitter entry window: seeded input ${label}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const retained = process.env.SPLITTER_ENTRY_CAPTURE_DIR;
        const scratch = retained ? path.resolve(retained, directory) : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-entry-"));
        if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_ENTRY_CAPTURE_DIR");
        fs.mkdirSync(scratch, {recursive: true});
        try {
            const fixture = GameFixturePaths.SPLITTER;
            const config = await loadConfigFromFile(path.join(fixture, "config.json"));
            const original = fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8").trim();
            const decoded = JSON.parse(zlib.inflateSync(Buffer.from(original.slice(1), "base64")).toString());
            const target = decoded.blueprint.entities.find((entity: {entity_number: number}) => entity.entity_number === 14);
            target.control_behavior = {circuit_enabled: true,
                circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
            decoded.blueprint.entities.push({entity_number: 22, name: "constant-combinator", position: {x: -72.5, y: 416.5}});
            decoded.blueprint.wires = [[14, 1, 22, 1]];
            const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
            const lua = composeProbeSource(path.join(fixture, "entry-window-probe.lua"), {...variant});
            fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
            fs.writeFileSync(path.join(scratch, "config.json"), JSON.stringify(config, null, 2) + "\n");
            fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
            const receivesUpstream = !!fromUpstream || incoming !== undefined;
            const sampleTicks = receivesUpstream || followers ? 10 : 4;
            await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
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
            if (tail !== undefined) expect(Object.values(report.initial.lines[6].stacks))
                .toMatchObject(expectedStacks(front === undefined ? [tail] : [front, tail]));
            expect(report.samples).toHaveLength(sampleTicks);
            let predicted = stock(report.initial.lines);
            let previous: Sample = report.initial;
            for (const sample of report.samples) {
                predicted = advanceRightPrioritySplitter(predicted, {upstream: receivesUpstream ? stock(previous.upstream) : [[], []]});
                expect(predicted, `seeded continuous replay at tick ${sample.tick}`).toEqual(stock(sample.lines));
                previous = sample;
            }
            if (front !== undefined || inputLast || otherFull || fromUpstream || followers) return;
            if (head < 32) {
                const entry = tail === undefined ? head + 45 : Math.max(head + 45, Math.max(0, tail - 32) + 64);
                if (entry < 128) expect(Object.values(report.samples[0].lines[6].stacks))
                    .toContainEqual(expect.objectContaining(expectedStacks([entry])[0]));
                else {
                    expect(Object.values(report.samples[0].lines[0].stacks)).toMatchObject(expectedStacks([0]));
                    expect(Object.values(report.samples[0].lines[4].stacks)).toEqual([]);
                    expect(Object.values(report.samples[1].lines[6].stacks)).toContainEqual(expect.objectContaining(expectedStacks([96])[0]));
                }
            } else {
                expect(Object.values(report.samples[0].lines[6].stacks)).toEqual([]);
                expect(Object.values(report.samples[0].lines[0].stacks)).toMatchObject(expectedStacks([0]));
                expect(Object.values(report.samples[1].lines[6].stacks)).toMatchObject(expectedStacks([45]));
            }
        } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
    }, 240_000);
}
