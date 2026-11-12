import { describe, expect, it } from "vitest";
import { describeCopiesShort } from "./shared-lane-trial";

describe("the sentence of a trial on the copies after which a copy is not back", () => {
    const short = [{ copy: 4, items_per_window_cycle: [96, 80] }];

    it("says that the infinite end of the output belt is shut, where the config states its output belt", () => {
        expect(describeCopiesShort({ kind: "output", item: "automation-science-pack" }, ["1/1"], 9, short, 96, true))
            .toBe("Automation science pack is not taken away at the infinite end of the output belt: the infinite end is shut, and every lane upstream "
                + "backs up from there. Then the infinite end opens again. Copy 4 from the entry ends at 96 and 80 a window cycle, where one copy makes 96.");
    });

    it("says that the copies do not have it taken away, where the config states no output belt", () => {
        expect(describeCopiesShort({ kind: "output", item: "automation-science-pack" }, ["1/1"], 9, short, 96))
            .toBe("Automation science pack is not taken away from the 9 copies, and is taken away again. "
                + "Copy 4 from the entry ends at 96 and 80 a window cycle, where one copy makes 96.");
    });
});
