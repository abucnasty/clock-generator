import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { Config } from "../config";
import { OpenRange } from "../data-types";
import { competingTakersOf, otherTakerOrdersOf } from "./trial";

const windows = (entries: Record<string, [number, number][]>) =>
    new Map(Object.entries(entries).map(([id, ranges]) => [id, ranges.map(([start, end]) => OpenRange.from(start, end))] as const));

// the electromagnetic science sample: inserters 2 and 3 both take the packs of the plant (machine 1) into one chest
describe("the taker orders a clock is checked under", () => {
    let electromagnetic: Config;
    let jellynut: Config;

    beforeAll(async () => {
        electromagnetic = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE);
        jellynut = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL);
    });

    it("names the inserters that take one product from one machine", () => {
        expect(competingTakersOf(electromagnetic)).toEqual([["inserter:2", "inserter:3"]]);
    });

    it("adds none where the two takers are never enabled in the same tick: they take turns, so no order can tell", () => {
        expect(otherTakerOrdersOf(electromagnetic, windows({ "inserter:1": [[0, 59]], "inserter:2": [[0, 9]], "inserter:3": [[30, 39]] }), 60)).toEqual([]);
    });

    it("adds the other way round where they are enabled together in one tick", () => {
        expect(otherTakerOrdersOf(electromagnetic, windows({ "inserter:1": [[0, 59]], "inserter:2": [[0, 9]], "inserter:3": [[9, 39]] }), 60)).toEqual(["ascending"]);
        // an inserter on no window is enabled all the time
        expect(otherTakerOrdersOf(electromagnetic, windows({ "inserter:1": [[0, 59]], "inserter:2": [[0, 9]] }), 60)).toEqual(["ascending"]);
    });

    // jellynut processing: inserters 6 to 9 take its jelly, two into each rocket fuel machine
    it("adds each rotation of the descending order where more than two are enabled together", () => {
        expect(otherTakerOrdersOf(jellynut, new Map(), 128)).toEqual([{ rotation: 1 }, { rotation: 2 }, { rotation: 3 }]);
        // two at a time, in turns of two: the two ways round
        expect(otherTakerOrdersOf(jellynut, windows({ "inserter:6": [[0, 30]], "inserter:7": [[0, 30]], "inserter:8": [[64, 94]], "inserter:9": [[64, 94]] }), 128))
            .toEqual(["ascending"]);
    });
});
