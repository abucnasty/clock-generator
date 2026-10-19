import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {BELT_SPEEDS, blueprintAtSpeed, speedCapture} from "../../helpers/belt-speed-fixtures";

import {compareOutputStock, outputClip, OutputReport} from "./output-stock-comparison";

interface Stack {id: number; at: number; count: number; item: string}
interface Sample {tick: number; held: number; source: number; sink: number; seeded_sink?: number;
    pieces: {lines: {stacks: Stack[] | Record<string, never>}[]}[]}
const stacks = (sample: Sample) => sample.pieces.flatMap(piece => piece.lines.flatMap(line => Object.values(line.stacks)));

// Seed transport stock once, after observing an untouched natural full hand. Never edit the hand.
for (const speed of BELT_SPEEDS) {
    const controls = [
        ...[80, 96, 112, 128, 144, 160, 176, 192].map(position => ({label: `requested seed ${position}`, key: String(position), position})),
        ...[-1, 0, 1].map(offset => ({label: `cutoff ${offset}`, key: `cutoff-${offset}`, position: 128 + speed.units * 16 + offset})),
    ];
    for (const {label, key, position} of controls) test(`occupied output ${speed.name}: ${label}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const capture = speedCapture(`drop-window-${speed.name}-${key}`);
        try {
            const fixture = GameFixturePaths.TURBO_BELT_DROP;
            const blueprint = blueprintAtSpeed(fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8"), speed);
            fs.writeFileSync(path.join(capture.directory, "scaffold.txt"), blueprint);
            await recordInFactorio({factorio: factorio!, save: save!, blueprint,
                lua: composeProbeSource(path.join(fixture, "probe.lua"), {stackSize: 4, beltPrefix: speed.prefix, ticks: 120, seedPosition: position}),
                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                ticks: 120, warmup_ticks: 120, settle_ticks: 0, seed: [], unclocked: true,
                game_speed: 1000, watch: false, timeout_seconds: 180, log() {}});
            const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/belt-drop-stacks.json"), "utf8")) as
                OutputReport & {initial: {state: Sample}; seed: {state: Sample}; samples: Sample[]};
            expect(compareOutputStock(outputClip(report, speed.name, key))).toEqual([]);
            expect(report.seed.state.held).toBe(16);
            expect(stacks(report.seed.state).filter(stack => stack.item === "copper-plate")).toHaveLength(1);
            const drops: {tick: number; count: number; positions: number[]}[] = [];
            let previous = report.initial.state;
            for (const sample of report.samples) {
                expect(sample.source + sample.held + sample.sink + (sample.seeded_sink ?? 0)
                    + stacks(sample).reduce((sum, stack) => sum + stack.count, 0)).toBe(sample.tick > 5 ? 36 : 32);
                if (sample.held < previous.held) {
                    const ids = new Set(stacks(previous).map(stack => stack.id));
                    drops.push({tick: sample.tick, count: previous.held - sample.held,
                        positions: stacks(sample).filter(stack => !ids.has(stack.id) && stack.item === "iron-plate").map(stack => Math.round(stack.at * 256))});
                }
                previous = sample;
            }
            expect(drops.length).toBe(8);
            fs.writeFileSync(path.join(capture.directory, "findings.json"), JSON.stringify({speed: speed.name,
                requested_position: position, actual_seed: stacks(report.seed.state).filter(stack => stack.item === "copper-plate"), drops}, null, 2) + "\n");
        } finally {capture.cleanup();}
    }, 240_000);

}
