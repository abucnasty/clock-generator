import path from "path";
import fs from "fs";
import { describe, expect, it } from "vitest";
import { Config } from "../config/schema";
import { loadConfigFromFile } from "../config/loader";
import { SerializableClockWindows } from "./clock";
import { judgeSharedLanes } from "./shared-lane-verdict";

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const FIXTURES = path.join(__dirname, "fixtures");
type Clocks = Record<string, { window_cycle_ticks: number; windows: SerializableClockWindows; terminal_swing_count?: number }>;
const clocksOf = (file: string): Clocks => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));

/** The config with lane facts stated on lanes of it, by "belt/lane" */
function withFacts(config: Config, facts: Record<string, Record<string, unknown>>): Config {
    return { ...config, belts: config.belts.map(belt => ({ ...belt,
        lanes: belt.lanes.map((lane, index) => ({ ...lane, ...(facts[`${belt.id}/${index + 1}`] ?? {}) })) as typeof belt.lanes })) };
}
const dead_end = { lane_end: { kind: "dead_end" } };

interface Recorded { name: string; holds_in_game: boolean; config: Config; windows: SerializableClockWindows; window_cycle_ticks: number }

const byRate = (it: Pick<Recorded, "config" | "windows" | "window_cycle_ticks">) => judgeSharedLanes(it.config, it.windows, it.window_cycle_ticks, quiet, { by_rate: true });

// The two tests of shared-lane-rate-judge.test.ts that take over 70 s each on CI: the clock takt_batches_swings_6 recorded in
// the game on the inserter build of three copies on ore lanes into loaders, where copy 3 made about 4,000 of 4,800 a minute.
describe("the rate judge on the clock recorded in the game on copies that share lanes (#733), the slow one", async () => {
    const recorded: Recorded[] = [];
    const d1 = withFacts(await loadConfigFromFile(path.join(FIXTURES, "inserter-crafting-240-3-copies-ore-lines.json")), { "2/1": dead_end, "2/2": dead_end });
    for (const [id, clock] of Object.entries(clocksOf("inserter-crafting-240-recorded-clocks.json"))) {
        if (id !== "takt_batches_swings_6") continue;
        recorded.push({ name: `inserter build, ore lanes into loaders: ${id}`, holds_in_game: false, config: d1, ...clock });
    }

    it.each(recorded)("$name: judged by the rate, as the game", it => {
        const judged = byRate(it);
        expect(judged.by_rate).toMatchObject({ spans: expect.any(Array) });
        expect(judged.losses.length === 0).toBe(it.holds_in_game);
    });

    it.each(recorded)("$name: a loss only after four times the run, its machine further behind at each doubling", it => {
        const judged = byRate(it);
        expect(judged.by_rate!.spans).toHaveLength(3);
        const behind = judged.losses[0].behind!;
        expect(behind.kind).toBe("machine");
        // more than a craft a window cycle behind over the run four times as long: a shortfall that grows with the run
        expect(behind.behind).toBeGreaterThan(judged.by_rate!.spans![2] / 2);
    });
});
