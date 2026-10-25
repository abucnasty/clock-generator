import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { OpenRange } from "../../data-types";
import type { StockRecording } from "../machine-stock";
import { inLoopInserterWindows } from "./loop-windows";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const every = (period: number, count: number, start: number, end: number) =>
    Array.from({ length: count }, (_, k) => OpenRange.from(start + k * period / count, end + k * period / count));
const plain = (ranges: OpenRange[] | undefined) => ranges?.map(range => [range.start_inclusive, range.end_inclusive]);
const noStock: StockRecording = { ticks: 0, machines: [], inserters: [] };

/** A run in which each named inserter drops a hand of 16 `hands` times a period, evenly */
function stockOf(inserter_ids: string[], period: number, hands: number, periods: number): StockRecording {
    const ticks = Math.floor(period * periods);
    const drops = new Set(Array.from({ length: Math.floor(periods * hands) }, (_, k) => Math.round(k * period / hands) + 5));
    const held = Array.from({ length: ticks }, (_, tick) => drops.has(tick) ? 0 : 16);
    return {
        ticks, machines: [],
        inserters: inserter_ids.map(inserter_id => ({ inserter_id, held, held_item: [], status: [], factorio_state: [] })),
    };
}

describe("inLoopInserterWindows", () => {
    // Agricultural science: egg biochambers 3 and 4 feed each other eggs (5 and 8) and the science biochamber 5 (9 and
    // 10); an egg biochamber takes no eggs while its output is at its block of 14, under a stack of 20, and takes eggs
    // under a limit of 7, under a hand of 16
    it("gives the inserters of a loop whose machines block under a stack turns after the windows out of the loop", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const windows = new Map<string, OpenRange[]>([
            ["inserter:9", every(480, 5, 23, 46)], ["inserter:10", every(480, 5, 23, 46)], ["inserter:12", every(480, 5, 0, 36)],
        ]);
        const got = inLoopInserterWindows(config, 480, windows, new Set(["inserter:9", "inserter:10"]), noStock, quiet);
        expect(Array.from(got.keys())).toEqual(["inserter:5", "inserter:8"]);
        expect(got.get("inserter:5")?.rule).toBe("turns");
        // slots of 96: a swing (8) after each window out of the loop opens, 50 ticks, the second inserter half a slot later
        expect(plain(got.get("inserter:5")?.windows)).toEqual([[31, 80], [127, 176], [223, 272], [319, 368], [415, 464]]);
        expect(plain(got.get("inserter:8")?.windows)).toEqual([[0, 32], [79, 128], [175, 224], [271, 320], [367, 416], [463, 479]]);
    });

    it("anchors the turns on the output windows where they outnumber the windows out of the loop", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        // a clock of 600 ticks that takes the output 25 times a period and the eggs 5 times
        const windows = new Map<string, OpenRange[]>([
            ["inserter:9", every(600, 5, 23, 50)], ["inserter:10", every(600, 5, 23, 50)], ["inserter:12", every(600, 25, 0, 4)],
        ]);
        const got = inLoopInserterWindows(config, 600, windows, new Set(["inserter:9", "inserter:10"]), noStock, quiet);
        expect(plain(got.get("inserter:5")?.windows)?.slice(0, 3)).toEqual([[8, 21], [32, 45], [56, 69]]);
        expect(plain(got.get("inserter:8")?.windows)?.slice(0, 3)).toEqual([[0, 9], [20, 33], [44, 57]]);
    });

    it("leaves the loop always enabled where its takers have no windows out of the loop", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const windows = new Map<string, OpenRange[]>([["inserter:9", every(480, 5, 23, 46)], ["inserter:12", every(480, 5, 0, 36)]]);
        // the windows of 9 are not ones the loop's takers were given out of the loop
        expect(inLoopInserterWindows(config, 480, windows, new Set(), noStock, quiet).size).toBe(0);
    });

    // Iron bacteria: biochambers 1 and 2 feed each other bacteria (7 and 8) and put the rest into a chest; a biochamber takes them under a limit of 28,
    // which holds a hand of 16, and its output block of 112 is over a stack of 50
    it("gives the inserters of a loop whose machines hold a hand under their limit a window of a swing and a tick for each hand", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        const period = 1728 / 19;
        // the output inserters of each biochamber (1 and 3, 4 and 6), as the 6-swing subtick clock has them
        const windows = new Map<string, OpenRange[]>(["inserter:1", "inserter:3", "inserter:4", "inserter:6"].map(id =>
            [id, [OpenRange.from(0, 20), OpenRange.from(30, 50), OpenRange.from(60, 80)]]));
        const got = inLoopInserterWindows(config, period, windows, new Set(), stockOf(["inserter:7", "inserter:8"], period, 2, 60), quiet);
        expect(got.get("inserter:7")?.rule).toBe("hands");
        // 2 hands a period of 90.95 ticks, from midway between the openings of the first two output windows (15)
        expect(plain(got.get("inserter:7")?.windows)).toEqual([[15, 23], [60, 68]]);
        expect(plain(got.get("inserter:8")?.windows)).toEqual([[15, 23], [60, 68]]);
    });

    it("leaves an inserter of a loop that moved no hand always enabled", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        expect(inLoopInserterWindows(config, 1728 / 19, new Map(), new Set(), stockOf(["inserter:7", "inserter:8"], 1728 / 19, 0, 60), quiet).size).toBe(0);
    });
});
