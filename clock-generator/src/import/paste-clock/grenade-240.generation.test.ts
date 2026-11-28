import * as fs from "fs";
import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FactorioData } from "../../data/factorio-data-types";
import type { ImportInputs } from "../index";
import { pasteClock, type IdMap, type LeftOut, type PasteClockRun, type Point, type ReadFile, type RecordedClock, type SampleFile } from "./paste-clock-helpers";

const ENGINE = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(file, "utf8");

const BUILD = "grenade-240";
type Case = { scaffold: string; sample: string; record: string; translation: Point; research: ImportInputs["research"]; id_map: IdMap; left_out: LeftOut; read: ReadFile };
const sampleCase = JSON.parse(read(path.join(__dirname, "cases", `${BUILD}.json`))) as Case;
const MOVES = JSON.parse(read(path.join(__dirname, "moves.json"))) as Record<string, { direction: string; cause: string }>;

describe("a pasted blueprint of the grenade 240 sample", () => {
    let run: PasteClockRun;

    beforeAll(async () => {
        run = await pasteClock({
            name: BUILD,
            text: read(path.join(ENGINE, sampleCase.scaffold)).trim(),
            data: JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as FactorioData,
            source: sampleCase.read,
            positioned: sampleCase.read,
            translation: sampleCase.translation,
            research: sampleCase.research,
            sample: JSON.parse(read(path.join(ENGINE, sampleCase.sample))) as SampleFile,
            units: 1,
            leftOut: sampleCase.left_out,
            idMap: sampleCase.id_map,
            record: JSON.parse(read(path.join(ENGINE, "record", `${sampleCase.record}.json`))) as RecordedClock,
        });
    });

    it("holds one unit of the sample and has every question answered by the file", () => {
        expect(run.unitsFound).toBe(1);
        expect(run.settled.unanswered).toEqual([]);
    });

    it("pairs every entity with the sample's by the id map, but those it leaves out", () => {
        expect(run.pairing.failures).toEqual([]);
        expect(run.pairing.leftOut).toEqual({ machine: [], drill: [], inserter: [], chest: [], ...sampleCase.left_out });
    });

    it("generates a clock", () => {
        expect(run.error).toBeNull();
        expect(run.summary).not.toBeNull();
    });

    it("selects a clock that is not the record's, in the way moves.json says", () => {
        expect(MOVES[BUILD], "moves.json has no entry for this build").toBeDefined();
        expect(run.comparison?.state, run.comparison?.differences.join("; ")).toBe("moved");
        expect(run.direction).toBe(MOVES[BUILD].direction);
    });
});
