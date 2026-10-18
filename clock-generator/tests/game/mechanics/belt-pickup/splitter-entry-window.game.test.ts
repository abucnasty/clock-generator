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

const variants: {head: number; tail?: number; front?: number; inputLast?: boolean; otherFull?: boolean; fromUpstream?: boolean; followers?: number; distance?: number}[] = [...[0, 19, 31, 32].map(head => ({head})),
    {head: 0, tail: 0}, {head: 19, tail: 32}, {head: 19, tail: 33}, {head: 19, tail: 44}, {head: 19, tail: 45}, {head: 19, tail: 95}, {head: 19, tail: 96},
    {head: 19, tail: 96, front: 0}, {head: 19, tail: 96, front: 32}, {head: 0, tail: 64, front: 0},
    {head: 0, tail: 64, front: 0, inputLast: true}, {head: 0, tail: 64, front: 0, otherFull: true}, {head: 0, tail: 64, front: 0, fromUpstream: true}, {head: 0, tail: 64, front: 0, followers: 1}, {head: 0, tail: 64, front: 0, followers: 2}, {head: 0, tail: 64, front: 0, followers: 1, distance: 65}, {head: 0, tail: 64, front: 0, followers: 1, distance: 128},
    {head: 0, tail: 64, front: 0, followers: 1, distance: 146}, {head: 0, tail: 64, front: 0, followers: 1, distance: 147},
    {head: 0, followers: 1, distance: 65}, {head: 0, tail: 64, front: 0, followers: 1, distance: 95},
    {head: 0, tail: 64, front: 0, followers: 1, distance: 96}, {head: 19, tail: 96, front: 0, followers: 1}];
for (const {head, tail, front, inputLast, otherFull, fromUpstream, followers, distance} of variants) test(`turbo splitter entry window: seeded input head ${head}${tail === undefined ? "" : `, output tail ${tail}`}${front === undefined ? "" : `, front ${front}`}${inputLast ? ", input seeded last" : ""}${otherFull ? ", other lane full" : ""}${fromUpstream ? ", upstream entry" : ""}${followers ? `, followers ${followers}` : ""}${distance ? `, distance ${distance}` : ""}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.SPLITTER_ENTRY_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, `head-${head}${tail === undefined ? "" : `-tail-${tail}`}${front === undefined ? "" : `-front-${front}`}${inputLast ? "-input-last" : ""}${otherFull ? "-other-full" : ""}${fromUpstream ? "-upstream" : ""}${followers ? `-followers-${followers}` : ""}${distance ? `-distance-${distance}` : ""}`) : fs.mkdtempSync(path.join(os.tmpdir(), "splitter-entry-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty SPLITTER_ENTRY_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const fixture = GameFixturePaths.SPLITTER;
        const config = await loadConfigFromFile(path.join(fixture, "config.json"));
        const decoded = JSON.parse(zlib.inflateSync(Buffer.from(fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8").trim().slice(1), "base64")).toString());
        const target = decoded.blueprint.entities.find((entity: {entity_number: number}) => entity.entity_number === 14);
        target.control_behavior = {circuit_enabled: true,
            circuit_condition: {first_signal: {type: "virtual", name: "signal-Z"}, comparator: "<", constant: 0}};
        decoded.blueprint.entities.push({entity_number: 22, name: "constant-combinator", position: {x: -72.5, y: 416.5}});
        decoded.blueprint.wires = [[14, 1, 22, 1]];
        const blueprint = "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded))).toString("base64");
        const lua = composeProbeSource(path.join(fixture, "entry-window-probe.lua"), {head, tail, front, inputLast, otherFull, fromUpstream, followers, distance});
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
        await recordInFactorio({factorio: factorio!, save: save!, config, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: fromUpstream || followers ? 12 : 6, warmup_ticks: 1200, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/splitter-entry-window.json"), "utf8"));
        expect(report.initial).toMatchObject({seeded_positions: true, requested_head: head});
        if (fromUpstream) expect(Object.values(report.initial.lines[0].stacks)).toEqual([]);
        else expect(Object.values(report.initial.lines[0].stacks)).toMatchObject(Array.from({length: 1 + (followers ?? 0)}, (_, index) => ({at: (head + index * (distance ?? 64)) / 256, item: "iron-plate", count: 4})));
        if (tail !== undefined) expect(Object.values(report.initial.lines[6].stacks)).toMatchObject(
            (front === undefined ? [tail] : [front, tail]).map(position => ({at: position / 256, item: "iron-plate", count: 4})));
        expect(report.samples).toHaveLength(fromUpstream || followers ? 10 : 4);
        const stock = (sample: {lines: {stacks: {id: number; at: number; item: string; count: number}[] | Record<string, never>}[]}): SplitterStack[][] =>
            sample.lines.map(line => Object.values(line.stacks).map(s => ({id: s.id, position: Math.round(s.at * 256), item: s.item, count: s.count})));
        let predicted = stock(report.initial);
        let previous = report.initial;
        for (const sample of report.samples) {
            predicted = advanceRightPrioritySplitter(predicted, {upstream: fromUpstream ? stock({lines: previous.upstream}) : [[], []]});
            expect(predicted, `seeded continuous replay at tick ${sample.tick}`).toEqual(stock(sample));
            previous = sample;
        }
        if (front !== undefined) return;
        if (inputLast || otherFull || fromUpstream || followers) return;
        if (head < 32) {
            const preferredEntry = tail === undefined ? head + 45 : Math.max(head + 45, Math.max(0, tail - 32) + 64);
            const preferredHasRoom = preferredEntry < 128;
            if (preferredHasRoom) {
                expect(Object.values(report.samples[0].lines[6].stacks)).toContainEqual(expect.objectContaining({at: preferredEntry / 256, item: "iron-plate", count: 4}));
            } else {
                expect(Object.values(report.samples[0].lines[0].stacks)).toMatchObject([{at: 0, item: "iron-plate", count: 4}]);
                expect(Object.values(report.samples[0].lines[4].stacks)).toEqual([]);
                if (front === undefined) expect(Object.values(report.samples[1].lines[6].stacks)).toContainEqual(expect.objectContaining({at: 96 / 256, item: "iron-plate", count: 4}));
            }
        } else {
            expect(Object.values(report.samples[0].lines[6].stacks)).toEqual([]);
            expect(Object.values(report.samples[0].lines[0].stacks)).toMatchObject([{at: 0, item: "iron-plate", count: 4}]);
            expect(Object.values(report.samples[1].lines[6].stacks)).toMatchObject([{at: 45 / 256, item: "iron-plate", count: 4}]);
        }
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 240_000);
