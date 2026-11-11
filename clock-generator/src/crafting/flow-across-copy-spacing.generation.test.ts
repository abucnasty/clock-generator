import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { FlowAcrossCopySpacingError } from "../config/errors";
import type { Config } from "../config/schema";
import { generateClockAlternatives } from "./generate-blueprint";

/** The config with belt 3 stating the flow direction given, or none */
function withBelt3Flow(config: Config, flow_direction: 4 | 8 | undefined): Config {
    return { ...config, belts: config.belts.map(belt => {
        if (belt.id !== 3) return belt;
        const { flow_direction: _stated, ...rest } = belt;
        return { ...rest, ...(flow_direction !== undefined && { flow_direction }) } as typeof belt;
    }) };
}

/** A logger that keeps the warnings that the lanes the copies share could not be checked */
function unchecked(): { warnings: string[]; logger: { log(): void; warn(message: string): void; error(): void; debug(): void } } {
    const warnings: string[] = [];
    return { warnings, logger: { log() { }, warn(message) { if (message.includes("could not be checked")) warnings.push(message); }, error() { }, debug() { } } };
}

// ADVANCED_CIRCUIT_240: three copies 10 tiles apart along x, whose coal belt (belt 3) runs east past every copy
describe("the advanced circuit build with the coal belt's flow direction", () => {
    it("across the copy spacing is refused before any clock is made, naming the belt", async () => {
        const config = withBelt3Flow(await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240), 8);
        expect(() => generateClockAlternatives(config, { logger: unchecked().logger })).toThrow(FlowAcrossCopySpacingError);
        expect(() => generateClockAlternatives(config, { logger: unchecked().logger })).toThrow(/^Belt 3 states flow_direction 8 \(south\)/);
    });

    // the clock selected with the coal belt going east as the config states it, and with no flow direction stated
    for (const [name, flow] of [["along the copy spacing", 4], ["not stated", undefined]] as const) {
        it(`${name} checks the shared lanes and selects the clock it selected before`, async () => {
            const { warnings, logger } = unchecked();
            const generated = generateClockAlternatives(withBelt3Flow(await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240), flow), { logger });
            const selected = generated.alternatives[generated.selected_index];
            expect([selected.id, selected.verdict, selected.result.schedule.counted_ticks]).toEqual(["takt_batches_observed", "stable", 528]);
            expect(warnings).toEqual([]);
        });
    }
});
