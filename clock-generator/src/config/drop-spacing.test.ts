import { describe, expect, it } from "vitest";
import { Config } from "./index";
import { ConfigPaths } from "./config-paths";
import { loadConfigFromFile } from "./loader";
import { copyGapNeededNote, describeDropSpacing, dropLines, dropSpacing } from "./drop-spacing";
import { LaneTraffic } from "../state/lane-traffic";

/**
 * The grenade build (REAL_OWNER_GRENADE): seven copies 12 tiles apart drop onto a turbo belt of two lanes. Inserters 1 and 2
 * stand in one row 3 tiles apart on the north line, inserters 7 and 8 in the other row. A clock starts each inserter's hand
 * at the ticks given.
 */
const grenade = async (change?: (config: Config) => void): Promise<Config> => {
    const config = structuredClone(await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE));
    change?.(config);
    return config;
};
const starts = (ticks: Record<number, number>) => new Map(Object.entries(ticks).map(([id, tick]) => [Number(id), [tick]]));
/** the hand-made clock: a line's inserters together */
const BY_LINE = starts({ 1: 6, 2: 6, 7: 62, 8: 62 });
/** the generated clock: the first inserter of each line together, the second together */
const BY_PLACE = starts({ 1: 6, 7: 6, 2: 62, 8: 62 });

describe("the drops of the grenade build onto its belt", () => {
    it("fit between each other when a line starts together, 12 tiles apart", async () => {
        const spacing = dropSpacing(await grenade(), BY_LINE, 112)!;
        expect(spacing.lines.map(line => [line.inserter_ids, line.hands, line.fits, line.pairs, line.longest_wait]))
            .toEqual([[[1, 2], 14, true, 0, 0], [[7, 8], 14, true, 0, 0]]);
        expect(spacing.gap).toBe(12);
        expect(spacing.belt_tiles).toBe(14);
        const text = describeDropSpacing(spacing);
        expect(text.title).toBe("Drops onto belt 1 fit between each other");
        expect(text.what).toBe("In every period of 112 ticks, inserters 1 and 2 of the 7 copies drop 14 hands onto belt 1, and each hand lands on a stretch of belt "
            + "of its own, so none waits. Inserters 7 and 8 do the same on the other side of the belt. The copies stand 12 tiles apart and the belt moves 14 tiles in a period.");
        expect(text.why).toBe("A tile of a belt lane holds one hand of 16 at stack size 4. A hand dropped where items already lie waits until they have moved on, "
            + "so the hands of all the copies have to land in the gaps the others leave.");
        expect(text.explanation).toBe("This holds for this spacing and these start ticks. Moving one inserter by a tile, or starting one group of inserters at another "
            + "tick, puts hands on top of each other. The belt is taken to run straight past these inserters.");
    });

    it("land on each other when the first inserters of the lines start together and the second ones 56 ticks later", async () => {
        const spacing = dropSpacing(await grenade(), BY_PLACE, 112)!;
        expect(spacing.lines.map(line => [line.inserter_ids, line.fits, line.pairs, line.longest_wait])).toEqual([[[1, 2], false, 7, 8], [[7, 8], false, 7, 8]]);
        // no spacing of the copies helps when the second inserter of a line starts 56 ticks (7 tiles) after the first
        expect(spacing.fitting_gaps).toEqual([]);
        expect(spacing.fitting_start).toEqual({ inserter_id: 2, ticks: [54, 70], same_as: 1 });
        const text = describeDropSpacing(spacing);
        expect(text.title).toBe("Drops onto belt 1 land on each other");
        expect(text.what).toBe("In every period of 112 ticks, inserters 1 and 2 of the 7 copies drop 14 hands onto belt 1. 7 pairs of them land on each other, and the later "
            + "hand of each pair waits, the longest 8 ticks. Inserter 1 starts at tick 6 and inserter 2 at tick 62. Inserters 7 and 8 of the 7 copies drop 14 hands onto belt 1. "
            + "7 pairs of them land on each other, and the later hand of each pair waits, the longest 8 ticks. Inserter 7 starts at tick 6 and inserter 8 at tick 62. "
            + "The copies stand 12 tiles apart and the belt moves 14 tiles in a period.");
        expect(text.explanation).toBe("The simulator does not count this wait: it drops each inserter's hand on a belt of its own, so the rate and stability shown for this "
            + "clock were worked out without it. The hands would fit with inserter 2 starting at tick 54 or 70, or at the same tick "
            + "as inserter 1. The belt is taken to run straight past these inserters.");
    });

    it("land on each other when the first inserter of every copy stands a tile off its place", async () => {
        const config = await grenade(it => { it.inserters[0].position = { x: it.inserters[0].position!.x - 1, y: it.inserters[0].position!.y }; });
        const spacing = dropSpacing(config, BY_LINE, 112)!;
        expect(spacing.lines.map(line => [line.fits, line.pairs, line.longest_wait])).toEqual([[false, 7, 8], [true, 0, 0]]);
    });

    it("land on each other with copies 11, 13 or 14 tiles apart, and fit at 10 and 16", async () => {
        const at = async (x: number) => dropSpacing(await grenade(it => { it.target_output.copy_offset = { x, y: 0 }; }), BY_LINE, 112)!.lines.every(line => line.fits);
        expect(await Promise.all([10, 11, 12, 13, 14, 16].map(at))).toEqual([true, false, true, false, false, true]);
    });

    it("name the spacings nearest to the copies' that fit", async () => {
        const spacing = dropSpacing(await grenade(it => { it.target_output.copy_offset = { x: 13, y: 0 }; }), BY_LINE, 112)!;
        expect(spacing.fitting_gaps).toEqual([12, 16]);
        expect(describeDropSpacing(spacing).explanation).toContain("The hands would fit with the copies 12 or 16 tiles apart.");
    });

    it("do not depend on the way the belt runs when a line starts together, nor when the answer is the same both ways", async () => {
        const without = await grenade(it => it.inserters.forEach(ins => { if (ins.sink.type === "belt") delete ins.sink.belt_direction; }));
        expect(dropSpacing(without, BY_LINE, 112)!.lines.every(line => line.fits)).toBe(true);
        expect(dropSpacing(without, BY_PLACE, 112)!.lines.every(line => !line.fits)).toBe(true);
    });

    it("are not told when the copies' gap is not given, and the note asks for it", async () => {
        const config = await grenade(it => { delete it.target_output.copy_offset; });
        expect(dropSpacing(config, BY_LINE, 112)).toBeNull();
        expect(copyGapNeededNote(config)).toBe("The 7 copies may drop onto the same belt 1. Say how far apart they stand to check whether their drops fit between each other.");
        expect(copyGapNeededNote(await grenade())).toBeNull();
        expect(copyGapNeededNote(await grenade(it => { it.target_output.copies = 1; delete it.target_output.copy_offset; }))).toBeNull();
    });

    it("are checked on their own when the copies stand in rows of their own", async () => {
        const spacing = dropSpacing(await grenade(it => { it.target_output.copy_offset = { x: 0, y: 40 }; }), BY_PLACE, 112)!;
        expect(spacing.gap).toBeNull();
        expect(spacing.lines.map(line => [line.hands, line.fits])).toEqual([[2, true], [2, true]]);
    });

    it("are not checked when an inserter of the belt has no place", async () => {
        const config = await grenade(it => { delete it.inserters[7].position; });
        expect(dropLines(config)).toEqual([]);
        expect(copyGapNeededNote(config)).toBeNull();
    });

    it("are left to the merge when the drop is marked as side-loading", async () => {
        const config = await grenade(it => it.inserters.forEach(ins => { if (ins.sink.type === "belt") ins.sink.drop_capture = { status: "side-loaded", tiles: 5 }; }));
        expect(dropLines(config)).toEqual([]);
    });
});

/** The lane model alone: hands of 4 stacks started at tick t of every period, 14 periods, then whether the last three all land at +0, +1, +2, +4 */
function replayFits(hands: { place: number; tick: number }[], period: number): boolean {
    const lane = new LaneTraffic();
    const spots = hands.map(hand => hand.place * 8);
    spots.forEach(spot => lane.registerSpot(spot));
    const active: { hand: number; start: number; placed: number[] }[] = [];
    let late = 0;
    for (let tick = 0; tick < 15 * period; tick++) {
        const n = Math.floor(tick / period);
        if (n < 14) hands.forEach((hand, index) => { if (tick === n * period + hand.tick) active.push({ hand: index, start: tick, placed: [] }); });
        for (const entry of [...active]) {
            if (lane.tryPlace(tick, spots[entry.hand])) entry.placed.push(tick - entry.start);
            if (entry.placed.length === 4) {
                active.splice(active.indexOf(entry), 1);
                if (Math.floor(entry.start / period) >= 11 && entry.placed.join() !== "0,1,2,4") late++;
            }
        }
    }
    return late === 0;
}

describe("the test of whether hands fit", () => {
    it("says what the simulator's lane model does with the same hands, for 300 layouts of a line of inserters and copies", async () => {
        let seed = 7;
        const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
        let fitting = 0;
        for (let trial = 0; trial < 300; trial++) {
            const gap = 1 + Math.floor(random() * 30) * 0.5, apart = Math.floor(random() * 7), copies = 2 + Math.floor(random() * 5);
            const ticks = [Math.floor(random() * 112), random() < 0.5 ? -1 : Math.floor(random() * 112)];
            const config = await grenade(it => {
                it.target_output.copies = copies;
                it.target_output.copy_offset = { x: gap, y: 0 };
                it.inserters[1].position = { x: it.inserters[0].position!.x + apart, y: it.inserters[0].position!.y };
            });
            const tick2 = ticks[1] < 0 ? ticks[0] : ticks[1];
            const spacing = dropSpacing(config, starts({ 1: ticks[0], 2: tick2 }), 112);
            if (spacing === null) continue;
            // belt runs west: places grow toward smaller x
            const hands = [];
            for (let copy = 0; copy < copies; copy++) {
                hands.push({ place: -(config.inserters[0].position!.x + copy * gap), tick: ticks[0] });
                hands.push({ place: -(config.inserters[1].position!.x + copy * gap), tick: tick2 });
            }
            const lowest = Math.min(...hands.map(hand => hand.place));
            const fits = replayFits(hands.map(hand => ({ ...hand, place: hand.place - lowest })), 112);
            expect(spacing.lines[0].fits, JSON.stringify({ gap, apart, copies, ticks: [ticks[0], tick2] })).toBe(fits);
            if (fits) fitting++;
        }
        expect(fitting).toBeGreaterThan(20);
        expect(fitting).toBeLessThan(280);
    });
});
