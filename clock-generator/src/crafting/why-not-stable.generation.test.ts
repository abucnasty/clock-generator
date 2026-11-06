import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { quiet } from "./generate-blueprint-test-helpers";

describe("why the selected clock does not meet goal 1, as a generation says it", () => {
    it("is the output chest filling up on issue #100's config, whose buffer chest nothing empties", async () => {
        // the config's former `type` on its machines is read with the game data, which the loader has from the samples above
        const generated = generateClockAlternatives(await loadConfigFromFile(path.join(__dirname, "../../tests/configs/issue-100-electromagnetic-science-buffer-chest.json")),
            { logger: quiet });
        expect(generated.alternatives.every(it => it.verdict === "unstable" && it.assessment.items_per_second === 0)).toBe(true);
        expect(generated.alternatives[generated.selected_index].result.stability_check.as_built?.full_output_chests).toEqual([{
            chest_id: 1, chest_type: "buffer-chest", name: "Chest 1", item: "electromagnetic-science-pack", item_label: "electromagnetic science pack",
            held: 9600, capacity: 9600, inserter_ids: [1, 2],
        }]);
        expect(generated.why_not_stable).toEqual({
            cause: "output chest full",
            message: "No clock holds the target rate of 48 a second: Chest 1 fills up. Nothing takes any electromagnetic science pack out of it, "
                + "so it holds 9,600 of 9,600 and inserters 1 and 2 have nowhere to drop. The closest, Batched swings: 2 output swings per "
                + "cycle, moves 0 a second, 48 under the target. Use an infinity chest, or add an inserter that takes the items out, and "
                + "generate again. Not made: Even hands (only "
                + "made where every inserter takes from a machine or a chest; inserter 5 takes from a belt); Shifted swings (no shifted round of swings passes the clock-only check).",
        });
    });

});
