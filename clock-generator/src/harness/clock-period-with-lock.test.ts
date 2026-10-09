import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { encodeBlueprintFile } from "../blueprints/serde";
import { generateClockAlternatives, generateClockForConfig } from "../crafting/generate-blueprint";
import { clockPeriodTicks } from "./factorio-harness";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/**
 * The period the harness cuts a recording into is read from the clock blueprint. The generated clock has two
 * conditions (the count under the period, the lock off) and else outputs, and a constant combinator for the lock that
 * is no count step: every shape of it has to read as the period it counts.
 */
describe("clockPeriodTicks on the clocks the generator makes, with the lock", () => {
    const entitiesOf = (blueprint: string) => JSON.parse(zlib.inflateSync(Buffer.from(blueprint.slice(1), "base64")).toString()).blueprint.entities as any[];

    it("reads a plain clock: the period of the plan", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const result = generateClockForConfig(config, { logger: quiet });
        const blueprint = encodeBlueprintFile({ blueprint: result.blueprint });
        const clock = entitiesOf(blueprint).find(entity => /^Clock for/.test(entity.player_description ?? ""));
        expect(clock.control_behavior.decider_conditions.conditions).toHaveLength(2);
        expect(clockPeriodTicks(blueprint)).toBe(result.simulation_duration.ticks);
    });

    it("reads a subtick clock: the whole ticks after which the fractional period repeats", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        const subtick = alternatives[selected_index].result.subtick!;
        expect(subtick.clock.period_ticks).toBe(1728);
        expect(clockPeriodTicks(encodeBlueprintFile({ blueprint: subtick.blueprint }))).toBe(1728);
    });

    it("reads a clock merged with its modulos and fuel clocks on signal-T: the count of the merged clock", async () => {
        const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS);
        const result = generateClockForConfig(config, { logger: quiet });
        const blueprint = encodeBlueprintFile({ blueprint: result.blueprint });
        const clock = entitiesOf(blueprint).find(entity => /^Clock for/.test(entity.player_description ?? ""));
        expect(clock.control_behavior.decider_conditions.conditions[0].first_signal.name).toBe("signal-T");
        const counted = clockPeriodTicks(blueprint)!;
        expect(counted).toBe(clock.control_behavior.decider_conditions.conditions[0].constant);
        expect(counted % result.simulation_duration.ticks).toBe(0);
        expect(counted).toBeGreaterThan(result.simulation_duration.ticks);
    });

    it("reads a subtick clock with fuel clocks of their own: the subtick count, not a fuel clock", async () => {
        const rocket_fuel = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const result = generateClockForConfig(
            { ...rocket_fuel, target_output: { ...rocket_fuel.target_output, items_per_second: 54 } },
            { logger: quiet, fuel_consumption_view: false },
        );
        const blueprint = encodeBlueprintFile({ blueprint: result.subtick!.blueprint });
        const fuel_clocks = entitiesOf(blueprint).filter(entity => /^Fuel clock/.test(entity.player_description ?? ""));
        expect(fuel_clocks.length).toBeGreaterThan(0);
        expect(clockPeriodTicks(blueprint)).toBe(result.subtick!.clock.period_ticks);
    });
});
