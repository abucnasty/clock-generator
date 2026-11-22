import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateClockAlternatives, planClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import type { MakerLogEvent } from "./maker-log";
import { quiet } from "./generate-blueprint-test-helpers";

// A utility science build at 320 a second with 3 copies: two foundries each hand low density structure to three of the six
// assemblers, and no clock made before Round-Robin Polling with metered takers is stable. A fixture, not a job of the record.
describe("Round-Robin Polling with metered takers on a build whose foundries each feed three assemblers", () => {
    let config: Config;
    let generated: ClockAlternativesResult;
    beforeAll(async () => {
        config = await loadConfigFromFile(path.join(__dirname, "fixtures", "utility-science-320-metered-takers.json"));
        generated = generateClockAlternatives(config, { logger: quiet });
    });
    const alternative = (id: string) => generated.alternatives.find(it => it.id === id);

    it("lists the metered clock stable at the target rate on 324 ticks, 6 output swings", () => {
        const metered = alternative("round_robin_polling_metered_takers");
        expect(metered, generated.alternatives.map(it => it.id).join(", ")).toBeDefined();
        expect([metered!.maker, metered!.verdict, metered!.assessment.items_per_second.toFixed(2), metered!.result.simulation_duration.ticks, metered!.result.used_terminal_swing_count])
            .toEqual(["metered-takers", "stable", "320.00", 324, 6]);
        expect(metered!.strategy).toMatchObject({ id: "round_robin_polling", settings: { shared_windows: "metered_takers" } });
    });

    it("clocks only the takers of the foundries, a hand each in a window of 4 ticks, in turn; every other inserter is always enabled", () => {
        const metered = alternative("round_robin_polling_metered_takers")!;
        const windows = metered.result.clock_windows;
        const source = (id: string) => config.inserters.find(inserter => `inserter:${inserter.id}` === id)!.source;
        const takers = Object.keys(windows).filter(id => id.startsWith("inserter:") && !(windows[id].length === 1 && windows[id][0].start === 0 && windows[id][0].end === 323));
        expect(takers.sort()).toEqual(["inserter:14", "inserter:16", "inserter:17", "inserter:5", "inserter:6", "inserter:9"]);
        for (const id of takers) {
            expect(source(id).type, id).toBe("machine");
            expect(windows[id].map(range => range.end - range.start + 1), id).toEqual([4, 4, 4]);
            expect(windows[id].map(range => range.start - windows[id][0].start), id).toEqual([0, 108, 216]);
        }
        const first = (id: string) => windows[id][0].start;
        // foundry 3's takers 36 apart, foundry 7's the same, 18 after foundry 3's
        expect(["inserter:5", "inserter:6", "inserter:9"].map(first)).toEqual([0, 36, 72]);
        expect(["inserter:14", "inserter:16", "inserter:17"].map(first)).toEqual([18, 54, 90]);
        const others = Object.keys(windows).filter(id => id.startsWith("inserter:") && !takers.includes(id));
        expect(others).toHaveLength(15);
        for (const id of others) expect(windows[id], id).toEqual([{ start: 0, end: 323 }]);
    });

    it("selects Coordinated Sources, made from it, stable at the target rate", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2), selected.result.simulation_duration.ticks])
            .toEqual(["coordinated_sources", "stable", "320.00", 324]);
    });
});

// ADVANCED_CIRCUIT_240, a job of the record: a machine there hands an ingredient to two or more of the machines that make the
// target, and the clock made before the fallbacks is stable, so the metered takers clock is planned and never made
describe("Round-Robin Polling with metered takers where a clock made before it is stable", () => {
    it("is planned as a fallback and not made", async () => {
        const config = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240);
        const fallbacks = planClockAlternatives(config, { logger: quiet }).tasks.filter(task => task.fallback === true).map(task => task.id);
        expect(fallbacks).toContain("metered-takers");
        const events: MakerLogEvent[] = [];
        const generated = generateClockAlternatives(config, { logger: quiet, maker_log: event => { events.push(event); } });
        expect(generated.alternatives[generated.selected_index].verdict).toBe("stable");
        expect(generated.alternatives.filter(it => it.maker === "metered-takers")).toEqual([]);
        expect(generated.not_made.filter(it => it.id === "metered-takers")).toEqual([]);
        const seconds = events.find(event => event.event === "seconds")!;
        expect(Object.keys(seconds.makers as Record<string, number>)).not.toContain("metered-takers");
    });
});
