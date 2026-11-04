import { describe, expect, test } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";

// Clocks of the grouped hands rule are also offered with the windows of the takers that open together made one, as an
// alternative of their own that ranking picks or leaves; every clock says how many deciders it has. The productivity chain
// is generated once, in productivity-chain.generation.test.ts, which asserts on it too.
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const generate = async (sample: keyof typeof ConfigPaths) => generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });

describe("military science: the shared windows keep the rate and recover where the separate ones do not", () => {
    test("the shared clock is selected with 4 deciders", async () => {
        const generated = await generate("MILITARY_SCIENCE");
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack-shared");
        expect(selected.verdict).toBe("stable");
        expect(selected.deciders).toBe(4);
        const separate = generated.alternatives.find(it => it.id === "planned-belt-slack")!;
        expect(separate.verdict).toBe("no recovery");
    });
});
