import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {Belt, BeltSpeed} from "../../../../src/entities/belt/belt";
import {BeltStackSize} from "../../../../src/entities/belt/belt-stack-size";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";
import {BELT_SPEEDS, blueprintAtSpeed} from "../../helpers/belt-speed-fixtures";

interface Stack {id: number; at: number; count: number; item: string}
interface Line {length: number; stacks: Stack[] | Record<string, never>}
interface Sample {tick: number; held: number; source: number; sink: number; pieces: {name: string; lines: Line[]}[]}
const beltPositions = (sample: Sample) => new Map(sample.pieces.slice(0, 3).flatMap((piece, index) =>
    piece.lines.flatMap(line => Object.values(line.stacks).map(stack => [stack.id, index + 1 - stack.at] as const))));
const stock = (sample: Sample) => sample.pieces.flatMap(p => p.lines.flatMap(l => Object.values(l.stacks)));

for (const speed of BELT_SPEEDS) for (const stackSize of [1, 2, 3, 4] as BeltStackSize[]) test(`${speed.name} belt drops: stack size ${stackSize}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.BELT_DROP_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, speed.name, String(stackSize)) : fs.mkdtempSync(path.join(os.tmpdir(), "belt-drop-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty BELT_DROP_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        const fixture = GameFixturePaths.TURBO_BELT_DROP;
        const blueprint = blueprintAtSpeed(fs.readFileSync(path.join(fixture, "scaffold.txt"), "utf8"), speed);
        const lua = composeProbeSource(path.join(fixture, "probe.lua"), {stackSize, beltPrefix: speed.prefix, ticks: 360});
        fs.writeFileSync(path.join(scratch, "probe.generated.lua"), lua);
        fs.writeFileSync(path.join(scratch, "blueprint.txt"), blueprint + "\n");
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua,
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"),
            ticks: 360, warmup_ticks: 120, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/belt-drop-stacks.json"), "utf8")) as {
            initial: {state: Sample}; samples: Sample[];
        };
        expect(report.initial.state.pieces.map(piece => piece.name)).toEqual([
            ...Array(3).fill(`${speed.prefix}transport-belt`), `${speed.prefix}loader`,
        ]);
        expect(report.initial).toMatchObject({stack_size: stackSize, hand_capacity: 16, research_unchanged: true});
        expect(report.samples).toHaveLength(360);
        expect(stock(report.initial.state)).toEqual([]);
        const hands: {tick: number; amount: number}[][] = [];
        const pickups: number[] = [];
        const effectiveHand = stackSize === 3 ? 15 : 16;
        let previous = report.initial.state;
        for (const sample of report.samples) {
            expect(sample.source + sample.held + sample.sink + stock(sample).reduce((sum, s) => sum + s.count, 0)).toBe(32);
            for (const stack of stock(sample)) {
                expect(stack.item).toBe("iron-plate");
                expect(stack.count).toBeGreaterThan(0);
                expect(stack.count).toBeLessThanOrEqual(stackSize);
            }
            if (sample.held > previous.held) {
                pickups.push(sample.held);
                hands.push([]);
            }
            if (sample.held < previous.held) hands.at(-1)!.push({tick: sample.tick, amount: previous.held - sample.held});
            const positions = beltPositions(sample);
            for (const [id, at] of beltPositions(previous)) {
                if (positions.has(id)) expect(positions.get(id)! - at).toBe(speed.units / 32);
            }
            previous = sample;
        }
        expect(pickups).toEqual(stackSize === 3 ? [15, 15, 2] : [16, 16]);
        const completed = hands.filter(drops => drops.length > 0);
        if (retained) fs.writeFileSync(path.join(scratch, "timing.json"), JSON.stringify({
            speed: speed.name, stackSize, hands: completed.map(hand => ({start: hand[0].tick,
                offsets: hand.map(drop => drop.tick - hand[0].tick), amounts: hand.map(drop => drop.amount)})),
        }, null, 2) + "\n");
        expect(completed).toHaveLength(2);
        const expectedHands = JSON.parse(fs.readFileSync(path.join(fixture, "speed-expectations.json"), "utf8"));
        expect(completed.map(hand => ({start: hand[0].tick,
            offsets: hand.map(drop => drop.tick - hand[0].tick), amounts: hand.map(drop => drop.amount)})))
            .toEqual(expectedHands[`${speed.name}/${stackSize}`]);
        for (const drops of completed) {
            expect(drops.reduce((sum,d) => sum+d.amount, 0)).toBe(effectiveHand);
            const start = drops[0].tick, end = drops.at(-1)!.tick;
            const receivingStock = report.samples[start - 2].pieces[0].lines.flatMap(line => Object.values(line.stacks));
            if (drops === completed[0]) expect(receivingStock).toEqual([]);
            else if (speed.name === "normal") expect(receivingStock.map(stack => stack.at)).toEqual([0, 0.25, 0.5]);
            for (const [index, drop] of drops.entries()) {
                const before = new Set(stock(report.samples[drop.tick - 2]).map(s => s.id));
                const created = report.samples[drop.tick - 1].pieces[0].lines.flatMap(line => Object.values(line.stacks))
                    .filter(stack => !before.has(stack.id));
                expect(created).toHaveLength(1);
                expect(created[0]).toMatchObject({item: "iron-plate", count: drop.amount});
                if (speed.name === "turbo") expect(created[0].at).toBe(Math.min(5 / 8, 3 / 8 + index / 8));
                expect(created[0].at).toBeGreaterThanOrEqual(0);
                expect(created[0].at).toBeLessThanOrEqual(1);
            }
            let remaining = effectiveHand;
            for (let tick = start; tick <= end; tick++) {
                const actual = drops.find(d => d.tick === tick)?.amount ?? 0;
                const expected = Math.min(remaining, Belt.amountToDropAtTick(speed.units * 15 as BeltSpeed, stackSize, tick - start));
                // A normal belt still has three preceding stacks at the next swing. Its new hand
                // has no room for the empty-belt burst; the native baseline above preserves that case.
                if (speed.name !== "normal" || drops === completed[0]) {
                    expect(actual, `stack ${stackSize}, drop offset ${tick-start}`).toBe(expected);
                }
                remaining -= actual;
            }
            expect(remaining).toBe(0);
        }
        expect(report.samples.at(-1)!).toMatchObject({source: 0, held: stackSize === 3 ? 2 : 0, sink: effectiveHand * 2});
        if (stackSize === 3) expect(hands.at(-1)).toEqual([]); // The final two items wait for a full hand.
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 240_000);
