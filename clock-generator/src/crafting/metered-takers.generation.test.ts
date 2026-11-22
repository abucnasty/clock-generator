import path from "path";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { InserterPhase } from "../simulation/status-codes";
import { World } from "../simulation/world";
import { runTick } from "../simulation/tick-phases";
import { coldControlledTrialBuild } from "./plan/unclocked-run";
import { buildAsBuiltConfig } from "./trial";
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

    it("clocks only the takers of the foundries, with the full pickup and the following swing entry both enabled, in turn; every other inserter is always enabled", () => {
        const metered = alternative("round_robin_polling_metered_takers")!;
        const windows = metered.result.clock_windows;
        const source = (id: string) => config.inserters.find(inserter => `inserter:${inserter.id}` === id)!.source;
        const takers = Object.keys(windows).filter(id => id.startsWith("inserter:") && !(windows[id].length === 1 && windows[id][0].start === 0 && windows[id][0].end === 323));
        expect(takers.sort()).toEqual(["inserter:14", "inserter:16", "inserter:17", "inserter:5", "inserter:6", "inserter:9"]);
        for (const id of takers) {
            expect(source(id).type, id).toBe("machine");
            expect(windows[id].map(range => range.end - range.start + 1), id).toEqual([2, 2, 2]);
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

    // Use the same six turn placements together from the empty start. Only the width differs.
    function coldTurns(width: number) {
        const { result } = alternative("round_robin_polling_metered_takers")!;
        const windows = new Map(Object.entries(result.clock_windows).map(([id, ranges]) => [id,
            ranges.map(range => OpenRange.from(range.start, ranges.length === 3 ? range.start + width - 1 : range.end))]));
        const on = buildAsBuiltConfig(config, windows, 324);
        const context = coldControlledTrialBuild(on, result.output_cycle_plan, result.used_lcm, {}, quiet);
        const world = World.of(context);
        let tick = 0;
        return {
            advance(to: number) {
                for (; tick < to; tick++) runTick(world, null);
            },
            arm: (id: number) => world.inserters.find(it => it.entity_id.number === id)!,
            stock: (id: number) => context.state_registry.getStateByEntityIdOrThrow(EntityId.forMachine(id))
                .inventoryState.getQuantity("low-density-structure"),
        };
    }

    it.each([8, 9])("tests the first return against the inclusive end of a %i-tick window", width => {
        const turn = coldTurns(width);
        const arm = turn.arm(6);
        turn.advance(38);
        expect(arm.inserter_state.held_item?.quantity).toBe(16);
        turn.advance(42);
        expect([arm.inserter_state.items_dropped, turn.stock(2)]).toEqual([16, 13]); // one craft used three
        turn.advance(46);
        expect(arm.inserter_state.items_picked_up).toBe(width === 8 ? 16 : 25);
    });

    it.each([1, 2])("keeps the cold partial until the next opening at width %i", width => {
        const turn = coldTurns(width);
        const arm = turn.arm(14);
        turn.advance(20);
        expect(arm.inserter_state.held_item?.quantity).toBe(4);
        turn.advance(127);
        expect([arm.inserter_state.items_picked_up, arm.inserter_state.items_dropped]).toEqual([4, 0]);
        turn.advance(128);
        expect(arm.inserter_state.held_item?.quantity).toBe(16);
        turn.advance(129);
        expect([arm.hand.phase, arm.control.enabledIn(0)]).toEqual([InserterPhase.SWING, width === 2]);
        turn.advance(136);
        expect([arm.inserter_state.items_picked_up, arm.inserter_state.items_dropped]).toEqual([16, 16]);
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
