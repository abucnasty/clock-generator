import { expect, test } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";

// The exact-speed recycler cell of the ore voider benchmark (save F, the benchmark's waste inserters clocked): a recycler at
// crafting speed 16.875 (540 crafts a second) destroys 400 iron ore a second, brought in by four stack inserters from the
// ore supply; it places what it gives back (a quarter of its crafts, at random) into a car, which two stack inserters
// empty back into it. The cell as it is, and the clock of the cell in the game, are jobs of the record, with their checks
// (tests/game/builds/job-checks/samples.ts); the build below is not.
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

test("names each clock by the hands brought in a cycle when the inserters have a chest each, as Sidecar exports the build", async () => {
    const config = await loadConfigFromFile(ConfigPaths.IRON_ORE_VOIDER_400_EXACT_SPEED);
    // as Sidecar exports the build: the four infinity chests where the design's wagon stood, one for each inserter
    const own_chests: Config = { ...config,
        inserters: config.inserters.map(it => it.source.id === 2 ? { ...it, source: { ...it.source, id: it.id! - 1 } } : it),
        chests: [config.chests![0], ...[2, 3, 4, 5].map(id => ({ ...config.chests![1], id }))] } as Config;
    expect(generateClockAlternatives(own_chests, { logger: quiet }).alternatives.map(it => it.label))
        .toEqual(["Batched swings: 5 hands brought in per cycle", "Even hands: 5 hands brought in per cycle"]);
});
