import { describe, expect, it } from "vitest";
import { Config } from "./index";
import { ConfigPaths } from "./config-paths";
import { loadConfigFromFile } from "./loader";
import { copyGapNeededNote, describeDropRoom, describeDropSpacing, DROP_SPACING_STATED_LANES, DROP_SPACING_STRAIGHT_BELT, DROP_SPACING_UNCHECKED, dropLines, dropRoom, dropSpacing, dropSpacingTable, dropTieBreak, partUncheckedText, uncheckedDrops, uncheckedPartDrops } from "./drop-spacing";
import { LaneTraffic } from "../state/lane-traffic";
import { partCopiesOf } from "../harness/factorio-harness";
import { dropRoomNote } from "../crafting/drop-room-note";
import { dropSpacingInsights } from "../crafting/insights";
import { buildToNameOf } from "../crafting/build-names";

/**
 * The grenade build (GRENADE_240_FILLS_BELT_EXACTLY): seven copies 12 tiles apart drop onto a turbo belt of two lanes. Inserters 1 and 2
 * stand in one row 3 tiles apart on the north line, inserters 7 and 8 in the other row. A clock starts each inserter's hand
 * at the ticks given.
 */
const grenade = async (change?: (config: Config) => void): Promise<Config> => {
    const config = structuredClone(await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY));
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
        expect(text.what).toBe("In every window cycle of 112 ticks, inserters 1 and 2 of the 7 copies drop 14 hands onto belt 1, and each hand lands on a stretch of belt "
            + "of its own, so none waits. Inserters 7 and 8 do the same on the other side of the belt. The copies stand 12 tiles apart and the belt moves 14 tiles in a window cycle.");
        expect(text.why).toBe("A tile of a belt lane holds one hand of 16 at stack size 4. A hand dropped where items already lie waits until they have moved on, "
            + "so the hands of all the copies have to land in the gaps the others leave.");
        expect(text.explanation).toBe("This holds for this spacing and these start ticks. Moving one inserter by a tile, or starting one group of inserters at another "
            + "tick, puts hands on top of each other."
            + " The belt moves 14 tiles a window cycle, so each hand lands on one of 14 tiles. With inserters 1 and 2 as they stand (3 tiles apart), the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; 13, 15, 17, 19, 23 or 25 apart only with a copy's inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14. Starting inserter 2 16, 32 or 48 ticks after inserter 1 also fits (a tile every 8 ticks). The belt is taken to run straight past these inserters. This assumes every copy drops onto the belt the way this one does.");
    });

    it("land on each other when the first inserters of the lines start together and the second ones 56 ticks later", async () => {
        const spacing = dropSpacing(await grenade(), BY_PLACE, 112)!;
        expect(spacing.lines.map(line => [line.inserter_ids, line.fits, line.pairs, line.longest_wait])).toEqual([[[1, 2], false, 7, 8], [[7, 8], false, 7, 8]]);
        expect(spacing.fitting_start).toEqual({ inserter_id: 2, ticks: [54, 70], same_as: 1 });
        const text = describeDropSpacing(spacing);
        expect(text.title).toBe("Drops onto belt 1 land on each other");
        expect(text.what).toBe("In every window cycle of 112 ticks, inserters 1 and 2 of the 7 copies drop 14 hands onto belt 1. 7 pairs of them land on each other, and the later "
            + "hand of each pair waits, the longest 8 ticks. Inserter 1 starts at tick 6 and inserter 2 at tick 62. Inserters 7 and 8 of the 7 copies drop 14 hands onto belt 1. "
            + "7 pairs of them land on each other, and the later hand of each pair waits, the longest 8 ticks. Inserter 7 starts at tick 6 and inserter 8 at tick 62. "
            + "The copies stand 12 tiles apart and the belt moves 14 tiles in a window cycle.");
        expect(text.explanation).toBe("The simulator does not count the waits between copies: it drops each copy's hands on a belt of its own, so the rate and stability shown for this "
            + "clock were worked out without them. The hands would fit with inserter 2 starting at tick 54 or 70, or at the same tick "
            + "as inserter 1. The belt moves 14 tiles a window cycle, so each hand lands on one of 14 tiles. With inserters 1 and 2 as they stand (3 tiles apart), the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; 13, 15, 17, 19, 23 or 25 apart only with a copy's inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14. Starting inserter 2 16, 32 or 48 ticks after inserter 1 also fits (a tile every 8 ticks). The belt is taken to run straight past these inserters. This assumes every copy drops onto the belt the way this one does.");
    });

    it("land on each other when the first inserter of every copy stands a tile off its place", async () => {
        const config = await grenade(it => { it.inserters[0].position = { x: it.inserters[0].position!.x - 1, y: it.inserters[0].position!.y }; });
        const spacing = dropSpacing(config, BY_LINE, 112)!;
        expect(spacing.lines.map(line => [line.fits, line.pairs, line.longest_wait])).toEqual([[false, 7, 8], [true, 0, 0]]);
    });

    it("land on each other with copies 11, 13 or 14 tiles apart, and fit at 10 and 16", async () => {
        const at = async (x: number) => dropSpacing(await grenade(it => { it.setpoint.copy_offset = { x, y: 0 }; }), BY_LINE, 112)!.lines.every(line => line.fits);
        expect(await Promise.all([10, 11, 12, 13, 14, 16].map(at))).toEqual([true, false, true, false, false, true]);
    });

    it("name the spacings of the copies and the distances between a copy's inserters that fit, from the width of a copy for one loop of the belt's 14 tiles", async () => {
        const room = dropSpacing(await grenade(it => { it.setpoint.copy_offset = { x: 13, y: 0 }; }), BY_LINE, 112)!.room!;
        expect([room.low, room.high, room.loop, room.gap, room.gap_in_scan]).toEqual([12, 25, 14, 13, 13]);
        expect(room.crowded).toBeNull();
        expect(room.fits).toEqual([12, 16, 18, 20, 22, 24]);
        expect(room.only_with).toEqual([{ spacings: [13, 15, 17, 19, 23, 25], apart: [7] }]);
        expect(room.never).toEqual([14, 21]);
        // a tile every 8 ticks, the belt running west: a delay of 32 ticks is 4 tiles, which with 3 tiles is the 7 apart that fits
        expect(room.starts_after).toEqual([32]);
        expect(room.pair).toEqual({ first: 1, second: 2, apart: 3 });
    });

    it("list the same spacings whatever spacing is typed, and place a spacing beyond the loop at the one in the list that fits as it does", async () => {
        const roomAt = async (x: number) => dropSpacing(await grenade(it => { it.setpoint.copy_offset = { x, y: 0 }; }), BY_LINE, 112)!.room!;
        const base = await roomAt(12);
        for (const x of [5, 11, 13, 26, 40, 80]) {
            const room = await roomAt(x);
            expect([room.low, room.high, room.fits, room.only_with, room.never]).toEqual([base.low, base.high, base.fits, base.only_with, base.never]);
        }
        expect((await roomAt(26)).gap_in_scan).toBe(12);
        expect((await roomAt(40)).gap_in_scan).toBe(26 - 14 + 0);
        expect((await roomAt(11)).gap_in_scan).toBe(25);
        // a spacing and the spacing plus a loop fit alike
        const at = async (x: number) => dropSpacing(await grenade(it => { it.setpoint.copy_offset = { x, y: 0 }; }), BY_LINE, 112)!.lines.every(line => line.fits);
        expect(await Promise.all([12, 26, 40, 13, 27, 41].map(at))).toEqual([true, true, true, false, false, false]);
    });

    it("scan a fixed range from the width of a copy, with no loop, where the belt does not move a whole number of tiles in a period", async () => {
        const room = dropSpacing(await grenade(), BY_LINE, 113)!.room!;
        expect(room.loop).toBeNull();
        expect([room.low, room.high]).toEqual([12, 12 + 2 * 15]);
        expect(describeDropRoom(room)).not.toMatch(/plus/);
    });

    it("say no spacing fits where the hands of a lane take more of it than the belt moves in a window cycle", async () => {
        // 7 copies of 3 inserters drop 21 hands on 14 tiles
        const crowded = await grenade(it => { it.inserters.push({ ...structuredClone(it.inserters[0]), id: 9, position: { x: it.inserters[0].position!.x + 1, y: it.inserters[0].position!.y } }); });
        const room = dropSpacing(crowded, starts({ 1: 0, 2: 0, 7: 0, 8: 0, 9: 0 }), 112)!.room!;
        expect(room.crowded).toEqual({ hands: 21, belt_tiles: 14, hand_tiles: 1 });
        expect([room.fits, room.only_with, room.never, room.starts_after]).toEqual([[], [], [], []]);
        expect(describeDropRoom(room)).toBe("The belt moves 14 tiles a window cycle, but the 7 copies drop 21 hands on it, so no spacing of the copies fits: some hands always wait for room.");
        // 14 hands on 14 tiles are not too many
        expect((await dropSpacing(await grenade(), BY_LINE, 112))!.room!.crowded).toBeNull();
        // the same at a window cycle of 100 ticks, 12.5 tiles
        expect(dropSpacing(await grenade(), BY_LINE, 100)!.room!.crowded).toEqual({ hands: 14, belt_tiles: 12.5, hand_tiles: 1 });
    });

    it("leave out the drops marked as side-loaded, count the hands of what is checked, and say the rest is not checked", async () => {
        const mark = (...ids: number[]) => (config: Config) => config.inserters.forEach((inserter, index) => {
            if (ids.includes(inserter.id ?? index + 1) && inserter.sink.type === "belt") inserter.sink.drop_capture = { status: "side-loaded", tiles: 3 };
        });
        // inserters 1 and 7 drop straight, 2 side-loads, 8 side-loads: the lines are what is left
        const some = dropSpacing(await grenade(mark(2, 8)), starts({ 1: 0, 7: 0 }), 112)!;
        expect(some.lines.map(line => [line.inserter_ids, line.hands, line.fits])).toEqual([[[1], 7, true], [[7], 7, true]]);
        expect(some.unchecked).toEqual([2, 8]);
        expect(describeDropSpacing(some).explanation).toContain(`${DROP_SPACING_UNCHECKED} `.trim());
        expect(DROP_SPACING_UNCHECKED).toBe("Drops that are side-loaded or go through a splitter are not checked here.");
        // a third kind: a drop onto another belt that nothing marks (a belt the stream may go on from) is a line of its own on that belt, and counted there
        const mixed = await grenade(it => {
            mark(2)(it);
            it.belts.push({ ...structuredClone(it.belts[0]), id: 2 });
            it.inserters.push({ ...structuredClone(it.inserters[0]), id: 9, position: { x: it.inserters[0].position!.x, y: it.inserters[0].position!.y - 3 }, sink: { type: "belt", id: 2, belt_direction: 12 } });
        });
        const three = dropSpacing(mixed, starts({ 1: 0, 7: 0, 8: 0, 9: 0 }), 112)!;
        expect(three.lines.map(line => [line.belt_id, line.inserter_ids, line.hands])).toEqual([[1, [1], 7], [1, [7, 8], 14], [2, [9], 7]]);
        expect(three.unchecked).toEqual([2]);
        // none marked: nothing to say about what is left out
        const none = dropSpacing(await grenade(), BY_LINE, 112)!;
        expect(none.unchecked).toEqual([]);
        expect(describeDropSpacing(none).explanation).not.toContain(DROP_SPACING_UNCHECKED);
        // every output inserter marked: no line is checked
        const all = await grenade(mark(1, 2, 7, 8));
        expect(dropLines(all)).toEqual([]);
        expect(dropSpacing(all, BY_LINE, 112)).toBeNull();
        expect(uncheckedDrops(all)).toEqual([1, 2, 7, 8]);
    });

    it("agree with the rule of the tiles for every spacing 1 to 28 and distance 1 to 13 between a copy's inserters, 7 copies on 14 tiles", async () => {
        const base = await grenade();
        const rule = (pitch: number, apart: number) => pitch % 7 === 0 ? false : pitch % 2 === 0 ? apart % 2 === 1 : apart === 7;
        for (let pitch = 1; pitch <= 28; pitch++) {
            for (let apart = 1; apart <= 13; apart++) {
                const config = structuredClone(base);
                config.setpoint.copy_offset = { x: pitch, y: 0 };
                for (const [one, two] of [[0, 1], [6, 7]]) config.inserters[two].position = { x: config.inserters[one].position!.x + apart, y: config.inserters[two].position!.y };
                const fits = dropSpacing(config, starts({ 1: 0, 2: 0, 7: 0, 8: 0 }), 112)!.lines.every(line => line.fits);
                expect(fits, `pitch ${pitch}, apart ${apart}`).toBe(rule(pitch, apart));
            }
        }
    });

    it("count a start 8 ticks later as one tile of distance", async () => {
        const at = async (delay: number, apart: number) => dropSpacing(await grenade(it => {
            for (const [one, two] of [[0, 1], [6, 7]]) it.inserters[two].position = { x: it.inserters[one].position!.x + apart, y: it.inserters[two].position!.y };
        }), starts({ 1: 0, 2: delay, 7: 0, 8: delay }), 112)!.lines.every(line => line.fits);
        // an odd distance fits and an even one collides; a delay of 8 ticks changes the distance by a tile, one of 16 by two
        expect(await Promise.all([[0, 3], [8, 3], [16, 3], [24, 3], [32, 3], [8, 4], [8, 2], [8, 1]].map(([delay, apart]) => at(delay, apart)))).toEqual([true, false, true, false, true, true, true, false]);
    });

    it("name no distance between a copy's inserters for a line that does not have two", async () => {
        const room = dropSpacing(await grenade(it => { it.setpoint.copies = 3; it.inserters.push({ ...structuredClone(it.inserters[0]), id: 9, position: { x: it.inserters[0].position!.x + 1, y: it.inserters[0].position!.y } }); }), starts({ 1: 0, 2: 0, 7: 0, 8: 0, 9: 0 }), 112)!.room!;
        expect(room.pair).toBeNull();
        expect(room.only_with).toEqual([]);
        expect(room.never).toEqual([]);
        expect(describeDropRoom(room)).toMatch(/^The belt moves 14 tiles a window cycle, so each hand lands on one of 14 tiles\. With the inserters as they stand, /);
    });

    it("do not list spacings below the width of a copy, and list from 1 where an entity has no place", async () => {
        const room = (await dropSpacing(await grenade(), starts({ 1: 0, 2: 0, 7: 0, 8: 0 }), 112))!.room!;
        expect(room.low).toBe(12);
        const loose = await grenade(it => { delete it.machines[0].position; });
        expect(dropSpacing(loose, starts({ 1: 0, 2: 0, 7: 0, 8: 0 }), 112)!.room!.low).toBe(1);
    });

    it("do not depend on the way the belt runs when a line starts together, nor when the answer is the same both ways", async () => {
        const without = await grenade(it => it.inserters.forEach(ins => { if (ins.sink.type === "belt") delete ins.sink.belt_direction; }));
        expect(dropSpacing(without, BY_LINE, 112)!.lines.every(line => line.fits)).toBe(true);
        expect(dropSpacing(without, BY_PLACE, 112)!.lines.every(line => !line.fits)).toBe(true);
    });

    it("are not told when the copies' gap is not given, and the note asks for it", async () => {
        const config = await grenade(it => { delete it.setpoint.copy_offset; });
        expect(dropSpacing(config, BY_LINE, 112)).toBeNull();
        expect(copyGapNeededNote(config)).toBe("The 7 copies may drop onto the same grenade belt (belt 1). Say how far apart they stand to check whether their drops fit between each other.");
        expect(copyGapNeededNote(await grenade())).toBeNull();
        expect(copyGapNeededNote(await grenade(it => { it.setpoint.copies = 1; delete it.setpoint.copy_offset; }))).toBeNull();
    });

    it("are checked on their own when the copies stand in rows of their own", async () => {
        const spacing = dropSpacing(await grenade(it => { it.setpoint.copy_offset = { x: 0, y: 40 }; }), BY_PLACE, 112)!;
        expect(spacing.gap).toBeNull();
        expect(spacing.lines.map(line => [line.hands, line.fits])).toEqual([[2, true], [2, true]]);
    });

    it("pair the copies along one belt where its lanes are shared, and not where each copy has a lane of its own", async () => {
        const shared = dropSpacing(await grenade(), BY_PLACE, 112)!;
        expect(shared.gap).toBe(12);
        expect(shared.lines.map(line => [line.hands, line.pairs])).toEqual([[14, 7], [14, 7]]);
        const per_copy = dropSpacing(await grenade(it => it.belts.forEach(belt => belt.lanes.forEach(lane => { lane.sharing = "per_copy"; }))), BY_PLACE, 112)!;
        expect(per_copy.gap).toBeNull();
        expect(per_copy.lines.map(line => [line.hands, line.pairs])).toEqual([[2, 0], [2, 0]]);
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

/** A sample with the direction each named inserter faces in the build (the Sidecar export's) */
const sample = async (file: string, directions: Record<number, number> = {}): Promise<Config> => {
    const config = structuredClone(await loadConfigFromFile(file));
    config.inserters.forEach((inserter, index) => {
        const direction = directions[inserter.id ?? index + 1];
        if (direction !== undefined) inserter.direction = direction;
    });
    return config;
};
/** The automation science build: its output inserter 2 faces north; copies 1-4 and 6-8 side-load, 5 and 9 drop onto stretches */
const automation = () => sample(ConfigPaths.AUTOMATION_SCIENCE_240, { 2: 0 });
const of = (spacing: ReturnType<typeof dropSpacing>) => spacing!.lines.map(line => [line.belt_id, line.inserter_ids, line.copies ?? null, line.hands]);

describe("the drops that the output belt states", () => {
    it("leave a side-loaded copy out of every line, and put each stated drop on the line of its stretch and lane, once", async () => {
        const config = await automation();
        const lines = dropLines(config).filter(line => line.belt_id === 2);
        expect(lines.map(line => line.inserters.map(entry => [entry.id, entry.copy, entry.along]))).toEqual([[[2, 4, 7]], [[2, 8, 0]]]);
        expect(uncheckedDrops(config)).toEqual([2]);
        // inserter 2 alone: two lines of one hand each, so none lands on another
        const spacing = dropSpacing(config, starts({ 2: 30 }), 120)!;
        expect(of(spacing)).toEqual([[2, [2], [5], 1], [2, [2], [9], 1]]);
        const text = describeDropSpacing(spacing);
        expect(text.title).toBe("Drops onto belt 2 fit between each other");
        expect(text.what).not.toMatch(/land on each other/);
        expect(text.explanation).toContain(DROP_SPACING_UNCHECKED);
        expect(spacing.room).toBeUndefined();
        // the table holds no row of a side-loaded copy, and the rows of stated drops give no tiles between copies
        expect(dropSpacingTable(spacing).rows).toEqual([["2", "1", "-", "15", "0", "0"], ["2", "1", "-", "15", "0", "0"]]);
    });

    it("are judged where they meet: three copies' drops 6 tiles apart on one stretch land on each other when a hand starts 48 ticks after another", async () => {
        const config = await sample(ConfigPaths.LOGISTIC_SCIENCE_240);
        const lines = dropLines(config);
        expect(lines.map(line => line.inserters.map(entry => [entry.copy, entry.along]))).toEqual([
            [[0, 0], [1, 6], [2, 12]], [[3, 6], [4, 0]], [[5, 0], [6, 6], [7, 12]], [[8, 0], [9, 6]], [[10, 0]]]);
        expect(uncheckedDrops(config)).toEqual([]);
        // a hand at each start of each stated drop, not repeated by copy_offset
        const spacing = dropSpacing(config, starts({ 2: 0 }), 120)!;
        expect(spacing.lines.map(line => [line.copies, line.hands, line.fits])).toEqual([
            [[1, 2, 3], 3, true], [[4, 5], 2, true], [[6, 7, 8], 3, true], [[9, 10], 2, true], [[11], 1, true]]);
        expect(spacing.room).toBeUndefined();
        expect(spacing.gap).toBeNull();
        // 12 tiles a window cycle: a hand 48 ticks (6 tiles) later at a drop 6 tiles further on meets the one before
        const meeting = dropSpacing(config, new Map([[2, [0, 48]]]), 96)!;
        expect(meeting.lines.map(line => [line.copies, line.pairs])).toEqual([[[1, 2, 3], 6], [[4, 5], 2], [[6, 7, 8], 6], [[9, 10], 2], [[11], 0]]);
    });

    it("give the tie break of the clock planner the place of the config's own copy only", async () => {
        const automation_drops = dropTieBreak(await automation(), 120)!;
        expect([...automation_drops.places.keys()].sort()).toEqual([3, 4, 5, 6]);
        const logistic = dropTieBreak(await sample(ConfigPaths.LOGISTIC_SCIENCE_240), 96)!;
        expect([...logistic.places.entries()]).toEqual([[2, { line: 0, along: 0 }]]);
        // the same lines as the check: the pairs it counts are those of dropSpacing
        expect(logistic.collisions(new Map([[2, [0, 48]]]))).toBe(16);
    });

    it("close with what was judged, not with a straight belt or a move of an inserter by a tile, which do not hold for them", async () => {
        // fit: automation's two lines of one hand
        const fit = describeDropSpacing(dropSpacing(await automation(), starts({ 2: 30 }), 120)!);
        expect(fit.what).toContain("so none waits for another of these hands.");
        expect(fit.explanation).toMatch(/^This holds for these start ticks\. Starting one group of inserters at another tick can put hands on top of each other\. /);
        expect(fit.explanation).not.toContain(DROP_SPACING_STRAIGHT_BELT);
        expect(fit.explanation).not.toMatch(/Moving one inserter by a tile/);
        expect(fit.explanation).toContain(DROP_SPACING_STATED_LANES);
        expect(DROP_SPACING_STATED_LANES).toMatch(/stretch and lane.*judged on its own.*from the output belt.*upstream are not counted/);
        // not fit: logistic's stretches
        const meeting = describeDropSpacing(dropSpacing(await sample(ConfigPaths.LOGISTIC_SCIENCE_240), new Map([[2, [0, 48]]]), 96)!, undefined, true);
        expect(meeting.title).toBe("Drops onto belt 1 land on each other");
        expect(meeting.explanation).not.toContain(DROP_SPACING_STRAIGHT_BELT);
        expect(meeting.explanation).toContain(DROP_SPACING_STATED_LANES);
        // a build of the config's own lines keeps its sentences, and says nothing of stretches
        const own = describeDropSpacing(dropSpacing(await grenade(), BY_LINE, 112)!);
        expect(own.explanation).toContain(DROP_SPACING_STRAIGHT_BELT);
        expect(own.explanation).not.toContain(DROP_SPACING_STATED_LANES);
    });

    it("say before Generate that the side-loaded drops are not checked, on the lines the check reads", async () => {
        const note = dropRoomNote(await automation());
        expect(note).toContain(DROP_SPACING_UNCHECKED);
        // stated drops stand where the output belt says: they need no gap between copies
        const no_gap = await sample(ConfigPaths.LOGISTIC_SCIENCE_240);
        delete no_gap.setpoint.copy_offset;
        expect(copyGapNeededNote(no_gap)).toBeNull();
    });
});

describe("a build whose copies all side-load", () => {
    it("forms no line and gives no drop insight (military science, inserters facing east)", async () => {
        const config = await sample(ConfigPaths.MILITARY_SCIENCE_240, { 1: 4, 2: 4 });
        expect(dropLines(config)).toEqual([]);
        expect(uncheckedDrops(config)).toEqual([1, 2]);
        expect(dropSpacing(config, starts({ 1: 0, 2: 0 }), 120)).toBeNull();
        const result = { serializable_state_transition_history: { total_duration_ticks: 120, entities: [] } } as unknown as Parameters<typeof dropSpacingInsights>[0];
        expect(dropSpacingInsights(result, config)).toEqual([]);
    });
});

describe("the note of a build of one copy whose output inserters drop onto two belts (chemical science)", () => {
    // inserters 1 and 2 drop onto belt 5 and inserters 3 and 4 onto belt 6, 8 hands on each in a window cycle of 352 ticks
    const every_88 = (first: number, second: number) => new Map([1, 2, 3, 4].map(id => [id, [0, 88, 176, 264].map(tick => tick + (id % 2 === 1 ? first : second))]));
    const chemical = async () => {
        const config = await sample(ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY);
        const spacing = dropSpacing(config, every_88(0, 40), 352)!;
        return { config, spacing, text: describeDropSpacing(spacing, { build: buildToNameOf(config), numbered: false }), plain: describeDropSpacing(spacing) };
    };

    it("is a note of lines that all fit, on 2 belts, of one copy", async () => {
        const { config, spacing } = await chemical();
        expect(config.setpoint.copies).toBe(1);
        expect(spacing.lines.map(line => [line.belt_id, line.inserter_ids, line.hands, line.fits])).toEqual([[5, [1, 2], 8, true], [6, [3, 4], 8, true]]);
    });

    it("names the belt of each line, and the title names both", async () => {
        const { text, plain } = await chemical();
        expect(plain.title).toBe("Drops onto belts 5 and 6 fit between each other");
        expect(plain.what).toContain("drop 8 hands onto belt 5, and each hand lands on a stretch of belt of its own, so none waits.");
        expect(plain.what).not.toMatch(/belts? 5 and (belt )?6/);
        expect(text.what).toMatch(/drop 8 hands onto the chemical science pack belt \(belt 5\), and each hand lands/);
        expect(text.what).not.toContain("(belt 5) and the chemical science pack belt (belt 6)");
    });

    it("says a second line does the same onto its own belt, and not on the other side of the belt, which is the same belt", async () => {
        const { text, plain } = await chemical();
        expect(plain.what).toContain("Inserters 3 and 4 do the same onto belt 6.");
        expect(text.what).toMatch(/do the same onto the chemical science pack belt \(belt 6\)\./);
        expect(text.what).not.toContain("other side of the belt");
        expect(plain.what).not.toContain("other side of the belt");
    });

    it("says the hands, not the hands of all the copies, where there is one copy", async () => {
        const { plain } = await chemical();
        expect(plain.why).toBe("A tile of a belt lane holds one hand of 16 at stack size 4. A hand dropped where items already lie waits until they have moved on, so the hands have to land in the gaps the others leave.");
        // the 7 copies of the grenade build keep the hands of all the copies
        expect(describeDropSpacing(dropSpacing(await grenade(), BY_LINE, 112)!).why).toContain("so the hands of all the copies have to land in the gaps the others leave.");
    });

    it("says no more of a move of an inserter by a tile than the check finds: here none puts hands on top of each other", async () => {
        const { spacing, plain } = await chemical();
        expect(spacing.lines.map(line => line.tile_move_collides)).toEqual([false, false]);
        expect(plain.explanation).toMatch(/^This holds for this spacing and these start ticks\. Starting one group of inserters at another tick can put hands on top of each other\. /);
        expect(plain.explanation).not.toContain("Moving one inserter by a tile");
        expect(plain.explanation).not.toContain("puts hands on top of each other");
    });

    it("keeps the sentence about a move by a tile where every move of every inserter of the lines does put hands on top of each other (grenade: 14 hands on 14 tiles)", async () => {
        const spacing = dropSpacing(await grenade(), BY_LINE, 112)!;
        expect(spacing.lines.map(line => line.tile_move_collides)).toEqual([true, true]);
        expect(describeDropSpacing(spacing).explanation).toMatch(/^This holds for this spacing and these start ticks\. Moving one inserter by a tile, or starting one group of inserters at another tick, puts hands on top of each other\. /);
    });
});

describe("a part copy", () => {
    it("drops the hands of the inserters the shared-lane model gives it: 5 whole copies and the part on each line (chemical science, 5.5 copies)", async () => {
        // the sample is one copy at 480/11 a second; the part copy needs the build it was before: 240 a second from 5.5 copies, 18 tiles apart
        const config = await sample(ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY, { 1: 8, 2: 8, 3: 0, 4: 0 });
        config.setpoint = { ...config.setpoint, items_per_second: 240, copies: 5.5, copy_offset: { x: 18, y: 0 } };
        const parts = partCopiesOf(config);
        // the shared-lane model gives one part set here
        expect(parts.length).toBe(1);
        const in_part = (ids: number[]) => ids.filter(id => parts[0].ids.has(`inserter:${id}`));
        const spacing = dropSpacing(config, starts({ 1: 0, 2: 0, 3: 0, 4: 0 }), 352)!;
        expect(spacing.lines.map(line => [line.belt_id, line.inserter_ids, line.part])).toEqual([[5, [1, 2], in_part([1, 2])], [6, [3, 4], in_part([3, 4])]]);
        expect(in_part([1, 2, 3, 4])).toEqual([1, 3]);
        // a hand of each inserter in each of 5 whole copies, and of the part's one
        expect(spacing.lines.map(line => line.hands)).toEqual([5 * 2 + 1, 5 * 2 + 1]);
        // the scan of the spacings counts the same hands
        const crowded = dropRoom(config, dropLines(config), 40)!;
        expect(crowded.crowded).toEqual({ hands: 11, belt_tiles: 5, hand_tiles: 1 });
    });
});

describe("a part copy whose inserters the model does not give", () => {
    // the grenade build takes its items from no lane the copies share, so the model of the shared lanes lays out no part copy
    const fractional = () => grenade(it => { it.setpoint.copies = 7.5; });

    it("is named as not checked, where the base judged the line with 8 copies", async () => {
        const config = await fractional();
        expect(partCopiesOf(config)).toEqual([]);
        expect(dropSpacing(config, BY_LINE, 112)).toBeNull();
        expect(uncheckedPartDrops(config)).toEqual([1, 2, 7, 8]);
        // whole copies have no part copy to ask for
        expect(uncheckedPartDrops(await grenade())).toEqual([]);
        const text = partUncheckedText([1, 2, 7, 8]);
        expect(text).toBe("The drops of inserters 1, 2, 7 and 8 are not checked here: the copies have a fraction, and the model of the lanes they share gives no partial copy for this build, "
            + "so the check cannot tell which inserters the partial copy holds.");
        // the note of the clock, where no line is checked, says so
        const result = { serializable_state_transition_history: { total_duration_ticks: 112, entities: [] } } as unknown as Parameters<typeof dropSpacingInsights>[0];
        const insights = dropSpacingInsights(result, config);
        expect(insights.map(insight => [insight.id, insight.title, insight.table])).toEqual([["drop-spacing", "Drops of a partial copy are not checked", undefined]]);
        expect(insights[0].what).toContain("The drops of ");
        expect(insights[0].what).toContain("are not checked here: the copies have a fraction");
        // the note of the editor says so too, rather than say nothing
        expect(dropRoomNote(config)).toContain("are not checked here: the copies have a fraction");
    });

    it("is named in the explanation of the lines that are checked", async () => {
        const spacing = dropSpacing(await grenade(), BY_PLACE, 112)!;
        expect(spacing.unchecked_part).toEqual([]);
        expect(describeDropSpacing(spacing).explanation).not.toContain("partial copy");
        const text = describeDropSpacing({ ...spacing, unchecked_part: [3] });
        expect(text.explanation).toContain(partUncheckedText([3]));
    });
});

describe("what the result says of the wait it shows", () => {
    it("says the simulator does not count waits between copies for drops at spots of the config (sink.drop)", async () => {
        const text = describeDropSpacing(dropSpacing(await grenade(), BY_PLACE, 112)!);
        expect(text.explanation).toMatch(/^The simulator does not count the waits between copies: it drops each copy's hands on a belt of its own, so the rate and stability shown for this clock were worked out without them\. /);
    });

    it("says the simulator does not count the wait for drops with no spot of the config", async () => {
        const config = await grenade(it => it.inserters.forEach(ins => { if (ins.sink.type === "belt") delete ins.sink.drop; }));
        const text = describeDropSpacing(dropSpacing(config, BY_PLACE, 112)!);
        expect(text.explanation).toMatch(/^The simulator does not count this wait: it drops each inserter's hand on a belt of its own, so the rate and stability shown for this clock were worked out without it\. /);
    });

    it("says the simulator counts the wait for the drops the output belt states, where its run of the copies was made", async () => {
        const meeting = dropSpacing(await sample(ConfigPaths.LOGISTIC_SCIENCE_240), new Map([[2, [0, 48]]]), 96)!;
        expect(meeting.lines[0].run_counts).toBe("counted_with_copies");
        const text = describeDropSpacing(meeting, undefined, true);
        expect(text.title).toBe("Drops onto belt 1 land on each other");
        expect(text.explanation).not.toMatch(/does not count/);
        expect(text.explanation).toMatch(/^The simulator counts this wait: it puts these hands on one lane too\. /);
    });

    it("says the copies were not run on the output belt where the run of the copies was not made (or is not known)", async () => {
        const meeting = dropSpacing(await sample(ConfigPaths.LOGISTIC_SCIENCE_240), new Map([[2, [0, 48]]]), 96)!;
        for (const text of [describeDropSpacing(meeting), describeDropSpacing(meeting, undefined, false)]) {
            expect(text.explanation).toMatch(/^The simulator did not run the copies of this clock on the output belt, so the rate and stability shown for it were worked out without the waits between copies\. /);
            expect(text.explanation).not.toMatch(/counts this wait/);
        }
    });
});

/** The lane model alone: hands of 4 stacks started at tick t of every window cycle, 14 window cycles, then whether the last three all land at +0, +1, +2, +4 */
function replayFits(hands: { place: number; tick: number }[], window_cycle_ticks: number): boolean {
    const lane = new LaneTraffic();
    const spots = hands.map(hand => hand.place * 8);
    spots.forEach(spot => lane.registerSpot(spot));
    const active: { hand: number; start: number; placed: number[] }[] = [];
    let late = 0;
    for (let tick = 0; tick < 15 * window_cycle_ticks; tick++) {
        const n = Math.floor(tick / window_cycle_ticks);
        if (n < 14) hands.forEach((hand, index) => { if (tick === n * window_cycle_ticks + hand.tick) active.push({ hand: index, start: tick, placed: [] }); });
        for (const entry of [...active]) {
            if (lane.tryPlace(tick, spots[entry.hand])) entry.placed.push(tick - entry.start);
            if (entry.placed.length === 4) {
                active.splice(active.indexOf(entry), 1);
                if (Math.floor(entry.start / window_cycle_ticks) >= 11 && entry.placed.join() !== "0,1,2,4") late++;
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
                it.setpoint.copies = copies;
                it.setpoint.copy_offset = { x: gap, y: 0 };
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
