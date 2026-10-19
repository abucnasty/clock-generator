import fs from "fs";
import path from "path";
import {expect} from "vitest";


interface Stack {id: number; at: number; count: number; item: string}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Hand {held: number; held_item?: string; lanes?: Line[]}
interface Sample {held?: number; held_item?: string; tick: number; hands?: Hand[]; lines?: Line[]; products_finished?: number}
interface Report {initial: {lines?: Line[]; state?: Sample}; samples: Sample[]}

/** Freeze natural native observations, rather than projecting a turbo delay onto slower splitters. */
export function splitterSpeedSummary(report: Report) {
    const count = report.samples[0].hands?.length ?? 1;
    const hands = Array.from({length: count}, () => [] as {item: string; ticks: number[]}[]);
    for (let target = 0; target < count; target++) {
        let before = 0;
        for (const sample of report.samples) {
            const hand = sample.hands?.[target] ?? {held: sample.held!, held_item: sample.held_item};
            if (hand.held > before) {
                expect(hand.held - before).toBe(4);
                if (!before) hands[target].push({item: hand.held_item!, ticks: []});
                expect(hand.held_item).toBe(hands[target].at(-1)!.item);
                hands[target].at(-1)!.ticks.push(sample.tick);
            }
            before = hand.held;
        }
    }
    const stripIds = (lines: Line[]) => lines.map(line => ({length: line.length,
        stacks: Object.values(line.stacks).map(({at, count, item}) => ({at, count, item}))}));
    return {hands, initial_stock: report.initial.lines ? [stripIds(report.initial.lines)]
        : report.initial.state!.hands!.map(hand => stripIds(hand.lanes!)),
    products: report.samples.at(-1)!.products_finished};
}

export function verifySplitterSpeedReport(report: Report, fixture: string, scratch: string, key: string, config: {inserters: {source: Record<string, unknown>; sink: {type: string}}[]; pickup_warnings?: unknown}, entityName: string) {
    const summary = splitterSpeedSummary(report);
    if (!process.env.SPLITTER_REPLAY_DIR) fs.writeFileSync(path.join(scratch, "timing.json"), JSON.stringify(summary, null, 2) + "\n");
    const expected = JSON.parse(fs.readFileSync(path.join(fixture, "speed-expectations.json"), "utf8"));
    const targets = config.inserters.map((inserter, index) => ({inserter, index}))
        .filter(({inserter}) => inserter.source.type === "belt" && inserter.sink.type === "machine");
    expect(targets).toHaveLength(report.samples[0].hands?.length ?? 1);
    for (const {inserter, index} of targets) {
        expect(inserter.source).toMatchObject({pickup_capture: {
            status: "unsupported", reason: "splitter", entity_type: "splitter", entity_name: entityName,
        }});
        expect(inserter.source).not.toHaveProperty("pickup_length");
        expect(inserter.source).not.toHaveProperty("near_lane");
        expect(config.pickup_warnings).toContainEqual({inserter_id: index + 1, reason: "splitter"});
    }
    expect(summary, key).toEqual(expected[key]);
}
